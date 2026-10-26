import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import Module from 'node:module'

const require = createRequire(import.meta.url)
let ts
try { ts = require('typescript') }
catch { ts = require(join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')) }

function loadTs(file) {
  const pathname = resolve(import.meta.dirname, '../', file)
  const source = readFileSync(pathname, 'utf8')
  const code = ts.transpileModule(source, { fileName: pathname, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = new Module(pathname)
  mod.filename = pathname
  mod.paths = Module._nodeModulePaths(resolve(pathname, '..'))
  mod._compile(code, pathname)
  return mod.exports
}
const { normalizeHost, YuqueClient } = loadTs('src/main/yuque.ts')
const { LocalDatabase } = loadTs('src/main/database.ts')

test('Host validation prevents credential exfiltration to arbitrary endpoints', () => {
  assert.equal(normalizeHost('https://www.yuque.com/'), 'https://www.yuque.com/api/v2')
  assert.equal(normalizeHost('https://team.yuque.com'), 'https://team.yuque.com/api/v2')
  for (const host of ['http://www.yuque.com','https://yuque.com.attacker.io','https://evil-yuque.com','https://evil.com','https://www.yuque.com@evil.com','https://www.yuque.com:4444','https://www.yuque.com/api/v2/anything']) {
    assert.throws(() => normalizeHost(host), undefined, host)
  }
})

test('API client uses official read endpoints and never exposes token as URL parameter', async () => {
  const requests = []
  const original = global.fetch
  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    if (String(url).endsWith('/user')) return new Response(JSON.stringify({ data: { id: 1, login: 'tester', name: '测试账号' } }), { status: 200 })
    if (String(url).includes('/repos/3/docs/5')) return new Response(JSON.stringify({ data: { id:5, title:'笔记', slug:'note', format:'markdown', updated_at:'2026-01-01T00:00:00.000Z' } }), { status: 200 })
    if (String(url).includes('/yfm/docs')) return new Response(JSON.stringify({ data:{ doc_id:5, yfm:'# 测试', updated_at:'2026-01-01T00:00:00.000Z' } }), { status: 200 })
    return new Response('missing', { status: 404 })
  }
  try {
    const client = new YuqueClient('https://www.yuque.com/api/v2', 'secret-token')
    const user = await client.user()
    assert.equal(user.login, 'tester')
    const doc = await client.doc(3, 5)
    assert.equal(doc.content, '# 测试')
    assert.equal(doc.editable, true)
    assert.equal(requests.length, 3)
    assert.equal(requests[2].url, 'https://www.yuque.com/api/v2/yfm/docs?doc_id=5')
    assert.ok(requests.every(x => x.init.headers['X-Auth-Token'] === 'secret-token'))
    assert.ok(requests.every(x => !x.url.includes('secret-token')))
  } finally { global.fetch = original }
})

test('Lake documents are read-only, never exposed to Markdown update path', async () => {
  const original = global.fetch
  global.fetch = async () => new Response(JSON.stringify({data:{id:5,title:'Lake',slug:'lake',format:'lake',body_lake:'<lake/>',body_html:'<p>visible</p>',updated_at:'2026-01-01'}}), {status:200})
  try {
    const doc = await new YuqueClient('https://www.yuque.com/api/v2', 'token').doc(3,5)
    assert.equal(doc.editable, false)
    assert.equal(doc.content, '<lake/>')
    assert.equal(doc.previewHtml, '<p>visible</p>')
  } finally { global.fetch = original }
})

test('SQLite stores document cache + local drafts and blocks account reset with unpublished work', () => {
  const path = mkdtempSync(join(tmpdir(), 'yuque-db-'))
  const db = new LocalDatabase(path)
  try {
    db.saveRepos([{id:7,name:'我的知识库',slug:'mybook'}])
    db.saveDoc({id:12,book_id:7,title:'文章',slug:'article',format:'markdown',content:'# hi',baseUpdatedAt:'2026-10-25',editable:true,source:'remote'})
    db.saveDraft(7,12,'# changed','2026-10-25')
    assert.equal(db.repos().length,1)
    assert.equal(db.doc(12).content,'# hi')
    assert.equal(db.draft(7,12).content,'# changed')
    assert.throws(() => db.resetForAccount(), /未同步草稿/)
    db.deleteDraft(12)
    db.resetForAccount()
    assert.equal(db.repos().length, 0)
    assert.equal(db.doc(12), null)
  } finally { db.close(); rmSync(path,{recursive:true,force:true}) }
})

test('SQLite metadata refresh does not destroy existing cached text', () => {
  const path = mkdtempSync(join(tmpdir(), 'yuque-db-'))
  const db = new LocalDatabase(path)
  try {
    db.saveDoc({id:12,book_id:7,title:'old',slug:'a',format:'markdown',content:'# keep me',baseUpdatedAt:'v1',editable:true,source:'remote'})
    db.saveDocMeta([{id:12,book_id:7,title:'updated',slug:'a',format:'markdown'}])
    assert.equal(db.doc(12).content,'# keep me')
    assert.equal(db.doc(12).title,'updated')
  } finally { db.close(); rmSync(path,{recursive:true,force:true}) }
})

const { publishDraft } = loadTs('src/main/sync.ts')
test('Version conflict never writes cloud and keeps the local draft', async () => {
  const localDraft = { repoId: 2, docId: 9, content: 'my changes', baseUpdatedAt: 'v1' }
  let didWrite = false
  let cleared = false
  const db = { draft: () => localDraft, saveDoc: () => {}, deleteDraft: () => { cleared=true } }
  const api = { doc: async () => ({editable:true,baseUpdatedAt:'v2'}), updateMarkdown: async () => { didWrite=true } }
  await assert.rejects(() => publishDraft(db,api,2,9), /CONFLICT/)
  assert.equal(didWrite,false)
  assert.equal(cleared,false)
})

test('Successful write is verified by readback before clearing draft', async () => {
  let calls = 0
  let saved = false
  let cleared = false
  const db = {
    draft: () => ({repoId:2,docId:9,content:'new yfm',baseUpdatedAt:'v1'}),
    saveDoc: () => {saved=true}, deleteDraft: () => {cleared=true}
  }
  const api = {
    doc: async () => {calls++; return { editable:true,content:calls===1?'old yfm':'new yfm',baseUpdatedAt:calls===1?'v1':'v2' }},
    updateMarkdown: async (id,content) => {assert.equal(id,9);assert.equal(content,'new yfm')}
  }
  await publishDraft(db,api,2,9)
  assert.equal(calls,2)
  assert.equal(saved,true)
  assert.equal(cleared,true)
})

test('Failed readback retains draft even if upload was accepted', async () => {
  let calls=0,cleared=false
  const db = {draft: () => ({content:'new yfm',baseUpdatedAt:'v1'}),saveDoc:()=>{},deleteDraft:()=>{cleared=true}}
  const api = {doc:async()=>{calls++;return {editable:true,content:calls===1?'old yfm':'changed server text',baseUpdatedAt:'v1'}},updateMarkdown:async()=>{}}
  await assert.rejects(()=>publishDraft(db,api,2,9),/回读内容/)
  assert.equal(cleared,false)
})

test('Publish request uses official YFM PUT payload with document ID', async () => {
  const old = global.fetch
  let captured
  global.fetch = async (url, init) => {
    captured = {url:String(url),method:init.method,body:JSON.parse(init.body)}
    return new Response(JSON.stringify({data:{doc_id:9,updated_at:'v2'}}),{status:200})
  }
  try {
    const api = new YuqueClient('https://www.yuque.com/api/v2','token')
    await api.updateMarkdown(9,'# after')
    assert.deepEqual(captured,{url:'https://www.yuque.com/api/v2/yfm/docs',method:'PUT',body:{doc_id:9,yfm:'# after'}})
  } finally { global.fetch = old }
})
