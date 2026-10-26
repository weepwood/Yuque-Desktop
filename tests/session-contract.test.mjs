import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const require=createRequire(import.meta.url)
let ts
try{ts=require('typescript')}catch{ts=require(join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'))}
const pathname=resolve(import.meta.dirname,'../src/shared/session-contract.ts')
const compiled=ts.transpileModule(readFileSync(pathname,'utf8'),{
  fileName:pathname,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText
const m={exports:{}}
new Function('module','exports','require',compiled)(m,m.exports,require)
const {unwrapResponse,requireId,limitQuery}=m.exports
test('wrapped user/document response and unwrapped note response',()=>{
  assert.deepEqual(unwrapResponse({data:{id:5}}),{id:5})
  assert.deepEqual(unwrapResponse({notes:[],pin_notes:[],has_more:false}),{notes:[],pin_notes:[],has_more:false})
  assert.throws(()=>unwrapResponse({status:404,message:'Not Found'}),/Not Found/)
})
test('IDs and search terms are validated before IPC',()=>{
  assert.equal(requireId(15),15)
  for(const id of [-1,0,1.1,NaN,'2',null])assert.throws(()=>requireId(id))
  assert.equal(limitQuery(' 测试 '),'测试')
  assert.throws(()=>limitQuery('x'.repeat(129)))
})
test('No renderer-side cookie extraction or arbitrary API endpoint',()=>{
  const main=readFileSync(resolve(import.meta.dirname,'../src/main/index.ts'),'utf8')
  const preload=readFileSync(resolve(import.meta.dirname,'../src/preload/index.ts'),'utf8')
  assert.match(main,/persist:yuque-web-login/)
  assert.match(main,/sandbox:true/)
  assert.match(main,/session\.fromPartition/)
  assert.doesNotMatch(preload,/cookie|token|readFile|writeFile|genericInvoke/i)
})
test('Read-only API calls supply required ids and search type',()=>{
  const src=readFileSync(resolve(import.meta.dirname,'../src/main/session-api.ts'),'utf8')
  assert.match(src,/\{ book_id: bookId \}/)
  assert.match(src,/\{ q, type: 'doc' \}/)
  assert.match(src,/credentials: 'include'/)
  assert.doesNotMatch(src,/method: 'PUT'|method: 'POST'/)
})
