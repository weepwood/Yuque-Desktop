import { app, BrowserWindow, ipcMain, protocol, session, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join, resolve, relative, extname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { AuthState, Account, Loaded } from '../shared/session-contract'
import { requireId, limitQuery } from '../shared/session-contract'
import { InternalYuqueApi, YuqueHttpError } from './session-api'
import { SessionCache } from './session-cache'

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
const PARTITION = 'persist:yuque-web-login'
const YUQUE_ORIGIN = 'https://www.yuque.com'
const development = Boolean(process.env.ELECTRON_RENDERER_URL)
const mime: Record<string,string> = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png',
  '.woff2':'font/woff2', '.json':'application/json; charset=utf-8'
}
let windowMain: BrowserWindow | null = null
let loginWindow: BrowserWindow | null = null
let cache: SessionCache
let api: InternalYuqueApi
let activeAccount: Account | undefined
let authState: AuthState = { state:'signed-out' }

function trustedFrame(e: IpcMainInvokeEvent): void {
  if (!windowMain || e.sender !== windowMain.webContents || !e.senderFrame || e.senderFrame !== windowMain.webContents.mainFrame)
    throw new Error('拒绝不可信 IPC 来源')
  const url = new URL(e.senderFrame.url)
  if (development ? url.origin !== new URL(process.env.ELECTRON_RENDERER_URL!).origin : url.protocol !== 'app:' || url.hostname !== 'yuque')
    throw new Error('拒绝外部页面 IPC')
}
function handle(name: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle('yuque:'+name, async (event,...args:unknown[]) => {
    trustedFrame(event)
    return fn(...args)
  })
}
function updateAuth(next: AuthState): AuthState {
  authState=next
  activeAccount=next.account
  windowMain?.webContents.send('yuque:auth-changed', next)
  return next
}
async function probe(): Promise<AuthState> {
  const current = session.fromPartition(PARTITION)
  const cookies=await current.cookies.get({url:YUQUE_ORIGIN,name:'_yuque_session'})
  if (!cookies.length) return updateAuth({state:'signed-out'})
  try {
    const account=await api.mine()
    cache.setAccount(account)
    const result=updateAuth({state:'authenticated',account})
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
    return result
  } catch(e) {
    if (e instanceof YuqueHttpError && [401,403].includes(e.status)) return updateAuth({state:'signed-out'})
    const account=cache.account()
    if (account) return updateAuth({state:'offline',account})
    return updateAuth({state:'signed-out'})
  }
}
function assertAccount(): number {
  if (!activeAccount || authState.state === 'signed-out') throw new Error('请先通过语雀网页登录')
  return activeAccount.id
}
async function readCached<T>(key:string, action:()=>Promise<T>):Promise<Loaded<T>> {
  const id=assertAccount()
  try { return cache.set(id,key,await action()) }
  catch(e) {
    // Authentication/authorization errors must not silently return cached private data.
    if (e instanceof YuqueHttpError && e.status < 500) throw e
    const cached=cache.get<T>(id,key)
    if (cached) return cached
    throw e
  }
}
function beginLogin(): void {
  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.focus(); return }
  const webSession=session.fromPartition(PARTITION)
  loginWindow=new BrowserWindow({
    width:1100,height:780,minWidth:760,minHeight:620,
    title:'登录语雀',backgroundColor:'#ffffff',autoHideMenuBar:true,
    webPreferences:{session:webSession,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false}
  })
  const authWindow=loginWindow
  authWindow.webContents.on('will-navigate',(event,url)=>{
    if (!url.startsWith('https://')) event.preventDefault()
  })
  authWindow.webContents.setWindowOpenHandler(({url})=> {
    if (!url.startsWith('https://')) return { action:'deny' }
    return {action:'allow',overrideBrowserWindowOptions:{
      autoHideMenuBar:true,
      webPreferences:{session:webSession,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false}
    }}
  })
  authWindow.on('closed',()=>{if(loginWindow===authWindow)loginWindow=null;void probe()})
  void authWindow.loadURL('https://www.yuque.com/login').catch(()=>{})
}
function ipc(): void {
  handle('auth-state',()=>probe())
  handle('login',()=>beginLogin())
  handle('logout',async()=>{
    // Destroy only this app's separate browsing partition; never touch the user's real browser cookies.
    await session.fromPartition(PARTITION).clearStorageData()
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
    updateAuth({state:'signed-out'})
  })
  handle('books',()=>readCached('books',()=>api.books()))
  handle('teams',()=>readCached('teams',()=>api.teams()))
  handle('catalog',(bookId:unknown)=>{
    const id=requireId(bookId)
    return readCached('catalog:'+id,()=>api.catalog(id))
  })
  handle('document',(bookId:unknown,docId:unknown)=>{
    const book=requireId(bookId),doc=requireId(docId)
    return readCached('document:'+book+':'+doc,()=>api.document(book,doc))
  })
  handle('search',(q:unknown)=>api.search(limitQuery(q)))
  handle('notes',(offset:unknown,search:unknown)=>{
    if (!Number.isSafeInteger(offset)||Number(offset)<0||Number(offset)>100000) throw new Error('非法分页偏移量')
    const query=limitQuery(search)
    return readCached('notes:'+offset+':'+query,()=>api.notes(Number(offset),query))
  })
  handle('note',(id:unknown)=>{
    const noteId=requireId(id)
    return readCached('note:'+noteId,()=>api.note(noteId))
  })
  handle('tags',()=>readCached('tags',()=>api.tags()))
  handle('open-external',async(target:unknown)=>{
    if(typeof target!=='string'||target.length>2048) throw new Error('非法链接')
    const url=new URL(target)
    if(url.protocol!=='https:'||url.hostname!=='www.yuque.com'||url.username||url.password) throw new Error('仅允许打开语雀官方链接')
    await shell.openExternal(url.href)
  })
}
async function openMain():Promise<void> {
  windowMain=new BrowserWindow({
    width:1480,height:940,minWidth:920,minHeight:660,show:false,
    title:'Yuque Desktop',backgroundColor:'#f6f7f9',autoHideMenuBar:true,
    titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',
    webPreferences:{
      preload:join(__dirname,'../preload/index.js'),
      contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false
    }
  })
  windowMain.once('ready-to-show',()=>windowMain?.show())
  windowMain.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  windowMain.webContents.on('will-navigate',event=>event.preventDefault())
  if(development) await windowMain.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else await windowMain.loadURL('app://yuque/index.html')
  void probe()
}
app.whenReady().then(async()=>{
  mkdirSync(app.getPath('userData'),{recursive:true})
  cache=new SessionCache(app.getPath('userData'))
  const webSession=session.fromPartition(PARTITION)
  webSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false))
  api=new InternalYuqueApi(webSession)
  webSession.cookies.on('changed',(_event,cookie,_cause,removed)=>{
    if(cookie.name==='_yuque_session' && !removed) void probe()
  })
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
  if(!development){
    const root=resolve(__dirname,'../renderer')
    protocol.handle('app',async(request)=>{
      try{
        const url=new URL(request.url)
        if(url.hostname!=='yuque') return new Response('Forbidden',{status:403})
        const path=decodeURIComponent(url.pathname)
        const filename=path==='/'?'index.html':path.replace(/^\//,'')
        const full=resolve(root,filename),rel=relative(root,full)
        if(rel.startsWith('..')||rel.startsWith('/')||!rel) return new Response('Forbidden',{status:403})
        const bytes=await readFile(full)
        return new Response(new Uint8Array(bytes),{headers:{
          'Content-Type':mime[extname(full)]||'application/octet-stream',
          'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'none'; frame-src 'self' about:; object-src 'none'; base-uri 'none'"
        }})
      }catch{return new Response('Not found',{status:404})}
    })
  }
  ipc()
  await openMain()
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)void openMain()})
}).catch(e=>{console.error('Application startup failed',e);app.quit()})
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()})
app.on('will-quit',()=>cache?.close())
