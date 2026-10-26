import { app, BrowserWindow, ipcMain, protocol, session, shell } from 'electron'
import { join, resolve, relative, extname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import type { IpcMainInvokeEvent } from 'electron'
import type { Session, YuqueUser, DocumentDetail } from '../shared/types'
import { normalizeHost, YuqueClient } from './yuque'
import { LocalDatabase } from './database'
import { CredentialVault } from './credentials'
import { publishDraft } from './sync'

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let mainWindow: BrowserWindow | null = null
let db: LocalDatabase
let vault: CredentialVault
const development = Boolean(process.env.ELECTRON_RENDERER_URL)
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8'
}

function validateSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || !event.senderFrame) throw new Error('IPC 来源不可信')
  const url = new URL(event.senderFrame.url)
  const valid = development
    ? url.origin === new URL(process.env.ELECTRON_RENDERER_URL!).origin
    : url.protocol === 'app:' && url.hostname === 'yuque'
  if (!valid || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('拒绝非主窗口 IPC 调用')
}

function handle(name: string, fn: (...args: any[]) => Promise<unknown> | unknown): void {
  ipcMain.handle(`yuque:${name}`, async (event, ...args: unknown[]) => {
    validateSender(event)
    return fn(...args)
  })
}

function sessionState(): Session {
  const userJson = db.setting('user')
  const host = db.setting('host') || 'https://www.yuque.com'
  const hasToken = Boolean(vault.get())
  const user = userJson ? JSON.parse(userJson) as YuqueUser : undefined
  return { connected: hasToken && Boolean(user), host, user }
}

function client(): YuqueClient {
  const token = vault.get()
  if (!token) throw new Error('请先连接语雀 Token')
  return new YuqueClient(normalizeHost(db.setting('host') || 'https://www.yuque.com'), token)
}
function resourceId(v: unknown): number {
  const x = Number(v)
  if (!Number.isSafeInteger(x) || x <= 0) throw new Error('无效的资源编号')
  return x
}
function checkPlainObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('无效的请求参数')
  return v as Record<string, unknown>
}

function createHandlers(): void {
  handle('session', () => sessionState())
  handle('connect', async (input: unknown) => {
    const value = checkPlainObject(input)
    if (typeof value.token !== 'string' || value.token.length < 6 || value.token.length > 1024) throw new Error('请输入有效的 Token')
    if (typeof value.host !== 'string' || value.host.length > 255) throw new Error('无效的站点地址')
    const host = normalizeHost(value.host)
    const api = new YuqueClient(host, value.token.trim())
    const user = await api.user() // Verify before saving credentials.
    const previous = db.setting('user')
    const previousUser = previous ? JSON.parse(previous) as YuqueUser : undefined
    if (previousUser && (previousUser.id !== user.id || db.setting('host') !== new URL(host).origin)) db.resetForAccount()
    vault.save(value.token.trim())
    db.setSetting('user', JSON.stringify(user))
    db.setSetting('host', new URL(host).origin)
    return sessionState()
  })
  handle('disconnect', () => {
    db.resetForAccount() // Unpublished drafts must never be silently discarded.
    vault.clear()
    db.removeSetting('user')
    db.removeSetting('host')
  })
  handle('list-repos', async () => {
    const user = sessionState().user
    if (!user) throw new Error('请先连接账号')
    try {
      const repos = await client().repositories(user.login)
      db.saveRepos(repos)
      return repos
    } catch (e) { const cached = db.repos(); if (cached.length) return cached; throw e }
  })
  handle('list-docs', async (repo: unknown) => {
    const id = resourceId(repo)
    try {
      const docs = await client().docs(id)
      db.saveDocMeta(docs)
      return docs
    } catch (e) { const cached = db.docs(id); if (cached.length) return cached; throw e }
  })
  handle('open-doc', async (repo: unknown, id: unknown) => {
    const repoId = resourceId(repo), docId = resourceId(id)
    try {
      const doc = await client().doc(repoId, docId)
      db.saveDoc(doc)
      return { doc, draft: db.draft(repoId, docId) }
    } catch (e) {
      const doc = db.doc(docId)
      if (doc && doc.book_id === repoId) return { doc, draft: db.draft(repoId, docId) }
      throw e
    }
  })
  handle('save-draft', (input: unknown) => {
    const val = checkPlainObject(input)
    const repoId = resourceId(val.repoId), docId = resourceId(val.docId)
    if (typeof val.content !== 'string' || Buffer.byteLength(val.content) > 4 * 1024 * 1024) throw new Error('草稿大小超过 4 MB')
    if (typeof val.baseUpdatedAt !== 'string' || !val.baseUpdatedAt || val.baseUpdatedAt.length > 100) throw new Error('缺少云端版本标识，无法安全保存')
    const current = db.doc(docId)
    if (!current || current.book_id !== repoId || !current.editable) throw new Error('此文档暂不支持编辑')
    const oldDraft = db.draft(repoId, docId)
    const base = oldDraft?.baseUpdatedAt || current.baseUpdatedAt
    db.saveDraft(repoId, docId, val.content, base)
  })
  handle('publish', async (input: unknown): Promise<DocumentDetail> => {
    const val = checkPlainObject(input)
    const repoId = resourceId(val.repoId), docId = resourceId(val.docId)
    return publishDraft(db, client(), repoId, docId)
  })
  handle('create-doc', async (input: unknown) => {
    const val = checkPlainObject(input)
    const repoId = resourceId(val.repoId)
    if (typeof val.title !== 'string' || !val.title.trim()) throw new Error('请输入文档标题')
    const doc = await client().create(repoId, val.title)
    db.saveDocMeta([doc])
    return doc
  })
  handle('open-external', async (value: unknown) => {
    if (typeof value !== 'string') throw new Error('URL 参数错误')
    const url = new URL(value)
    if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*yuque\.com$/i.test(url.hostname)) throw new Error('只允许打开官方语雀链接')
    await shell.openExternal(url.href)
  })
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 650,
    backgroundColor: '#f6f7f9', title: 'Yuque Desktop',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, webviewTag: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  if (development) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else await mainWindow.loadURL('app://yuque/index.html')
}

app.whenReady().then(async () => {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  db = new LocalDatabase(dir)
  vault = new CredentialVault(dir)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  if (!development) {
    const root = resolve(__dirname, '../renderer')
    protocol.handle('app', async request => {
      try {
        const url = new URL(request.url)
        if (url.hostname !== 'yuque') return new Response('Forbidden', { status: 403 })
        const pathname = decodeURIComponent(url.pathname)
        const name = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
        const full = resolve(root, name)
        const rel = relative(root, full)
        if (rel.startsWith('..') || rel.startsWith('/') || !rel) return new Response('Forbidden', { status: 403 })
        const bytes = await readFile(full)
        return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentTypes[extname(full)] || 'application/octet-stream' } })
      } catch { return new Response('Not found', { status: 404 }) }
    })
  }
  createHandlers()
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
}).catch(error => { console.error('Failed to start:', error); app.quit() })

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('will-quit', () => db?.close())
