<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import type { Account, AuthState, Book, CatalogNode, Note, NotesPage, SearchHit, SearchResults, YuqueDocument } from '../../shared/session-contract'
import {
  BookOpen, BookMarked, FolderClosed, FolderOpen, FileText, NotebookPen, Search,
  Settings2, RefreshCw, Sun, Moon, LogOut, ChevronRight, ChevronDown, CircleUserRound,
  PanelLeftClose, PanelLeftOpen, ExternalLink, WifiOff, Wifi, ArrowUpRight, Hash,
  Loader2, Sparkles, ShieldCheck, Command, LockKeyhole, Cloud, Layers3, Pin, X,
  FileSearch2, AlertCircle, ListFilter
} from 'lucide-vue-next'

type Mode = 'books' | 'notes' | 'search'
type Row = { node: CatalogNode; depth: number }
const auth = ref<AuthState>({state:'signed-out'})
const books = ref<Book[]>([])
const catalog = ref<CatalogNode[]>([])
const notes = ref<Note[]>([])
const pinned = ref<Note[]>([])
const hasMore = ref(false)
const results = ref<SearchHit[]>([])
const totalHits = ref(0)
const activeBookId = ref<number | null>(null)
const activeDoc = ref<YuqueDocument | null>(null)
const activeNote = ref<Note | null>(null)
const section = ref<Mode>('books')
const selectedNode = ref<number | null>(null)
const selectedNote = ref<number | null>(null)
const currentQuery = ref('')
const bookFilter = ref('')
const noteFilter = ref('')
const message = ref('')
const loading = ref(false)
const reading = ref(false)
const signingIn = ref(false)
const stale = ref(false)
const sidebarCollapsed = ref(false)
const dark = ref(localStorage.getItem('yuque-session-theme') === 'dark')
const expanded = ref<Set<string>>(new Set())
const scrollTop = ref(0)
const viewportHeight = ref(620)
const treeScroller = ref<HTMLElement | null>(null)
let cancelAuth: (()=>void) | undefined
let queryTimeout: ReturnType<typeof setTimeout> | undefined
let viewGeneration = 0
let requestGeneration = 0
const ROW_HEIGHT=39

const connected = computed(()=>auth.value.state!=='signed-out')
const account = computed<Account|undefined>(()=>auth.value.account)
const currentBook = computed(()=>books.value.find(b=>b.id===activeBookId.value))
const personalBooks = computed(()=>books.value.filter(b=>b.user_id===account.value?.id || !b.user_id).filter(filterBook))
const teamBooks = computed(()=>books.value.filter(b=>b.user_id && b.user_id!==account.value?.id).filter(filterBook))
const documentTitle = computed(()=>activeDoc.value?.title || noteTitle(activeNote.value) || '')
const recordUrl = computed(()=>{
  if(activeNote.value) return activeNote.value.slug ? 'https://www.yuque.com/r/note/'+encodeURIComponent(activeNote.value.slug) : ''
  if(!activeDoc.value || !currentBook.value || !account.value) return ''
  const book=currentBook.value
  const owner=book.user?.login || book.group?.login || book.namespace?.split('/')[0]
  if(!owner)return ''
  return 'https://www.yuque.com/'+encodeURIComponent(owner)+'/'+encodeURIComponent(book.slug)+'/'+encodeURIComponent(activeDoc.value.slug)
})
function filterBook(b:Book):boolean { return !bookFilter.value || b.name.toLowerCase().includes(bookFilter.value.toLowerCase()) }
function textOnly(raw:string):string {
  const el=document.createElement('div')
  el.innerHTML=DOMPurify.sanitize(raw)
  return (el.textContent||'').replace(/\s+/g,' ').trim()
}
function noteTitle(note?:Note|null):string {
  if(!note)return ''
  const plain=textOnly(note.content?.abstract || note.content?.html || '')
  return plain.slice(0,48)||'无标题小记'
}
const frameHtml=computed(()=>{
  const html=activeNote.value ? (activeNote.value.content?.html || activeNote.value.content?.source || '')
    : (activeDoc.value?.content || '')
  const safe=DOMPurify.sanitize(html,{
    USE_PROFILES:{html:true}, FORBID_TAGS:['script','iframe','object','embed','form','input','button','textarea','select','base','link','meta'],
    FORBID_ATTR:['srcset','autofocus','formaction']
  })
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; base-uri 'none'; form-action 'none'"><style>html{color-scheme:light}body{margin:0;padding:32px 42px 70px;font:15px/1.9 system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#242b36;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%;overflow:auto}td,th{border:1px solid #dfe4eb;padding:8px 12px}pre{background:#f4f6fa;padding:16px;overflow:auto;border-radius:9px}blockquote{border-left:3px solid #7395d3;padding-left:15px;color:#64748b}h1,h2,h3{line-height:1.45}a{color:#3678cb}</style></head><body>${safe}</body></html>`
})
const visibleTree=computed<Row[]>(()=>{
  const byParent=new Map<string,CatalogNode[]>(),all=new Set(catalog.value.map(n=>n.uuid))
  for(const node of catalog.value) {
    if(node.visible===0)continue
    const parent=all.has(node.parent_uuid)?node.parent_uuid:''
    if(!byParent.has(parent))byParent.set(parent,[])
    byParent.get(parent)!.push(node)
  }
  const found=new Set<string>(),rows:Row[]=[]
  const visit=(parent:string,depth:number):void=>{
    if(depth>50)return
    for(const node of byParent.get(parent)||[]) {
      if(found.has(node.uuid))continue
      found.add(node.uuid)
      rows.push({node,depth})
      if(expanded.value.has(node.uuid))visit(node.uuid,depth+1)
    }
  }
  visit('',0)
  return rows
})
const windowStart=computed(()=>Math.max(0,Math.floor(scrollTop.value/ROW_HEIGHT)-8))
const virtualRows=computed(()=>visibleTree.value.slice(windowStart.value,windowStart.value+Math.ceil(viewportHeight.value/ROW_HEIGHT)+18))
const treeHeight=computed(()=>visibleTree.value.length*ROW_HEIGHT)
const offsetTop=computed(()=>windowStart.value*ROW_HEIGHT)
function notify(value:string):void { message.value=value;setTimeout(()=>{if(message.value===value)message.value=''},5500) }
function showError(e:unknown):void { notify(e instanceof Error?e.message:String(e)) }
function updateTheme():void {
  document.documentElement.classList.toggle('dark',dark.value)
  localStorage.setItem('yuque-session-theme',dark.value?'dark':'light')
}
function changeTheme():void {dark.value=!dark.value;updateTheme()}
async function bootstrap():Promise<void>{
  try {
    auth.value=await window.yuque.authState()
  }catch(e){showError(e)}
}
async function startLogin():Promise<void>{
  signingIn.value=true
  try {await window.yuque.login();notify('请在弹出的语雀登录窗口完成登录，成功后会自动进入。')}
  catch(e){showError(e)}
  finally{signingIn.value=false}
}
async function signOut():Promise<void>{
  if(!confirm('退出登录将清除本客户端的语雀会话 Cookie。确认继续？'))return
  try{
    await window.yuque.logout()
    auth.value={state:'signed-out'};books.value=[];catalog.value=[];notes.value=[]
    activeDoc.value=null;activeNote.value=null;activeBookId.value=null;selectedNode.value=null;selectedNote.value=null
  }catch(e){showError(e)}
}
async function loadBooks():Promise<void>{
  loading.value=true
  try {
    const result=await window.yuque.books()
    books.value=result.value.sort((a,b)=>(b.content_updated_at||'').localeCompare(a.content_updated_at||''))
    stale.value=result.stale
    if(!activeBookId.value && books.value.length)await chooseBook(books.value[0]!.id)
  }catch(e){showError(e)}
  finally{loading.value=false}
}
async function chooseBook(id:number):Promise<void>{
  section.value='books';activeBookId.value=id
  activeDoc.value=null;activeNote.value=null;selectedNode.value=null;catalog.value=[];scrollTop.value=0
  const seq=++requestGeneration
  loading.value=true
  try{
    const result=await window.yuque.catalog(id)
    if(seq!==requestGeneration)return
    catalog.value=result.value
    stale.value=result.stale
    expanded.value=new Set(result.value.filter(n=>n.type==='TITLE'&&(!n.parent_uuid||n.level===0)).map(n=>n.uuid))
    notify(result.stale?'正在查看离线缓存目录':'')
  }catch(e){showError(e)}
  finally{if(seq===requestGeneration)loading.value=false}
}
function toggle(node:CatalogNode):void{
  const updated=new Set(expanded.value)
  updated.has(node.uuid)?updated.delete(node.uuid):updated.add(node.uuid)
  expanded.value=updated
}
async function chooseNode(node:CatalogNode):Promise<void>{
  if(node.type!=='DOC'||!node.doc_id){toggle(node);return}
  selectedNode.value=node.doc_id;selectedNote.value=null
  activeDoc.value=null;activeNote.value=null
  const id=activeBookId.value
  if(!id)return
  const generation=++viewGeneration;reading.value=true
  try{
    const result=await window.yuque.document(id,node.doc_id)
    if(generation!==viewGeneration)return
    activeDoc.value=result.value;stale.value=result.stale
  }catch(e){showError(e)}
  finally{if(generation===viewGeneration)reading.value=false}
}
async function chooseHit(hit:SearchHit):Promise<void>{
  const bookId=hit._record?.book_id
  if(!bookId){notify('搜索结果缺少 book_id，无法安全读取正文');return}
  activeBookId.value=bookId;section.value='search';activeDoc.value=null;activeNote.value=null
  const generation=++viewGeneration;reading.value=true
  try {
    const result=await window.yuque.document(bookId,hit.id)
    if(generation===viewGeneration){activeDoc.value=result.value;stale.value=result.stale}
  }catch(e){showError(e)}
  finally{if(generation===viewGeneration)reading.value=false}
}
async function doSearch():Promise<void>{
  section.value='search'
  if(!currentQuery.value.trim()){results.value=[];totalHits.value=0;return}
  const generation=++requestGeneration
  loading.value=true
  try{
    const found:SearchResults=await window.yuque.search(currentQuery.value)
    if(generation!==requestGeneration)return
    results.value=found.hits;totalHits.value=found.totalHits
  }catch(e){showError(e)}
  finally{if(generation===requestGeneration)loading.value=false}
}
function scheduleSearch():void{
  clearTimeout(queryTimeout)
  queryTimeout=setTimeout(()=>{void doSearch()},420)
}
async function showNotes(reset=true):Promise<void>{
  section.value='notes';activeBookId.value=null;activeDoc.value=null;selectedNode.value=null
  if(reset){notes.value=[];pinned.value=[]}
  await loadNotes(reset?0:notes.value.length)
}
async function loadNotes(offset:number):Promise<void>{
  const generation=++requestGeneration
  loading.value=true
  try {
    const result=await window.yuque.notes(offset,noteFilter.value)
    if(generation!==requestGeneration)return
    notes.value=offset===0?result.value.notes:[...notes.value,...result.value.notes]
    pinned.value=result.value.pin_notes
    hasMore.value=result.value.has_more;stale.value=result.stale
  }catch(e){showError(e)}
  finally{if(generation===requestGeneration)loading.value=false}
}
async function chooseNote(note:Note):Promise<void>{
  selectedNote.value=note.id;activeNote.value=null;activeDoc.value=null
  const generation=++viewGeneration;reading.value=true
  try{
    const result=await window.yuque.note(note.id)
    if(generation===viewGeneration){activeNote.value=result.value;stale.value=result.stale}
  }catch(e){showError(e)}
  finally{if(generation===viewGeneration)reading.value=false}
}
async function openWeb():Promise<void>{
  if(!recordUrl.value){notify('无法从当前文档信息确定官方链接');return}
  try{await window.yuque.openExternal(recordUrl.value)}catch(e){showError(e)}
}
async function refresh():Promise<void>{
  if(section.value==='books'){if(activeBookId.value)await chooseBook(activeBookId.value);else await loadBooks()}
  else if(section.value==='notes')await showNotes()
  else await doSearch()
}
function globalKey(e:KeyboardEvent):void{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();section.value='search';document.getElementById('global-query')?.focus()}
}
watch(auth,(next,old)=>{
  if(next.state==='authenticated' && old?.state!=='authenticated')void loadBooks()
})
onMounted(()=>{
  updateTheme()
  cancelAuth=window.yuque.onAuthChanged(state=>auth.value=state)
  window.addEventListener('keydown',globalKey)
  void bootstrap()
})
onUnmounted(()=>{
  cancelAuth?.();clearTimeout(queryTimeout);window.removeEventListener('keydown',globalKey)
})
</script>

<template>
<div class="desktop-root">
  <aside class="rail">
    <div class="rail-brand" title="Yuque Desktop"><BookOpen :size="23" /></div>
    <div class="rail-items">
      <button class="rail-btn" :class="{ active:section==='books' }" title="知识库" @click="section='books'"><BookMarked :size="20"/></button>
      <button class="rail-btn" :class="{ active:section==='notes' }" title="小记" @click="showNotes()"><NotebookPen :size="20"/></button>
      <button class="rail-btn" :class="{ active:section==='search' }" title="全站搜索" @click="section='search'"><Search :size="20"/></button>
    </div>
    <div class="rail-bottom">
      <button class="rail-btn" title="切换主题" @click="changeTheme"><Sun v-if="dark" :size="20"/><Moon v-else :size="20"/></button>
      <button class="rail-btn" :title="sidebarCollapsed?'展开侧栏':'收起侧栏'" @click="sidebarCollapsed=!sidebarCollapsed"><PanelLeftOpen v-if="sidebarCollapsed" :size="20"/><PanelLeftClose v-else :size="20"/></button>
      <span class="rail-avatar" :title="account?.name||'未登录'">{{ account?.name?.slice(0,1)||'雀' }}</span>
    </div>
  </aside>
  <template v-if="!connected">
    <main class="welcome">
      <div class="welcome-head"><span class="brand-mini"><Cloud :size="17"/> YUQUE DESKTOP</span><span class="version-tag">Electron · Preview 0.2</span></div>
      <div class="welcome-center">
        <div class="welcome-mark"><BookOpen :size="34"/></div>
        <span class="welcome-overline">A QUIETER SPACE FOR KNOWLEDGE</span>
        <h1>让知识，流动起来<span>.</span></h1>
        <p>在桌面上重新发现语雀。完整知识库目录、小记与全文搜索，<br/>清爽高效的阅读空间，免去手动配置 API Token。</p>
        <button class="signin-action" :disabled="signingIn" @click="startLogin">
          <Loader2 v-if="signingIn" class="spin" :size="18"/><LockKeyhole v-else :size="18"/>
          在语雀官方页面登录 <ArrowUpRight :size="17"/>
        </button>
        <div class="signin-explainer"><ShieldCheck :size="16"/> 登录 Cookie 仅由独立 Electron 会话管理，不传给界面。</div>
        <div class="welcome-feature"><span><Layers3 :size="15"/> 目录树</span><span><FileSearch2 :size="15"/> 全文搜索</span><span><NotebookPen :size="15"/> 小记</span><span><WifiOff :size="15"/> 离线缓存</span></div>
      </div>
      <div class="welcome-footer"><span>非官方第三方客户端 · 目前仅提供安全只读功能</span><span>Windows & macOS</span></div>
    </main>
  </template>
  <template v-else>
    <aside v-if="!sidebarCollapsed" class="space-panel">
      <div class="side-heading"><span>WORKSPACE</span><button class="quiet-icon" title="刷新" @click="loadBooks"><RefreshCw :size="16" :class="{ spin:loading }"/></button></div>
      <div class="account-card"><div class="account-logo">{{account?.name?.slice(0,1)||'Y'}}</div><div class="account-info"><strong>{{account?.name}}</strong><small>@{{account?.login}}</small></div><span class="online-dot" :class="{ dim:auth.state==='offline' }"></span></div>
      <div v-if="section==='books'" class="space-content">
        <div class="space-search"><Search :size="15"/><input v-model="bookFilter" placeholder="筛选知识库" aria-label="筛选知识库"/></div>
        <div class="section-label"><span>个人知识库</span><small>{{personalBooks.length}}</small></div>
        <div class="book-scroll">
          <button v-for="book in personalBooks" :key="book.id" class="book-link" :class="{chosen:activeBookId===book.id}" @click="chooseBook(book.id)"><FolderOpen v-if="activeBookId===book.id" :size="16"/><FolderClosed v-else :size="16"/><span>{{book.name}}</span><ChevronRight v-if="activeBookId===book.id" :size="14"/></button>
          <div v-if="!personalBooks.length" class="hint">暂无符合条件的知识库</div>
          <div v-if="teamBooks.length" class="section-label secondary-section"><span>团队与协作</span><small>{{teamBooks.length}}</small></div>
          <button v-for="book in teamBooks" :key="book.id" class="book-link" :class="{chosen:activeBookId===book.id}" @click="chooseBook(book.id)"><Layers3 :size="16"/><span>{{book.name}}</span></button>
        </div>
      </div>
      <div v-else-if="section==='notes'" class="space-content">
        <div class="space-search"><Search :size="15"/><input v-model="noteFilter" placeholder="搜索小记" @keydown.enter="showNotes()" aria-label="搜索小记"/></div>
        <div class="section-label"><span>我的小记</span><small>{{notes.length}}</small></div>
        <div class="book-scroll">
          <button v-for="note in pinned" :key="'pin'+note.id" class="book-link" :class="{ chosen: selectedNote===note.id }" @click="chooseNote(note)"><Pin :size="14"/><span>{{noteTitle(note)}}</span></button>
          <button v-for="note in notes" :key="note.id" class="note-link" :class="{ chosen: selectedNote===note.id }" @click="chooseNote(note)"><NotebookPen :size="16"/><div><strong>{{noteTitle(note)}}</strong><small>{{note.updated_at?.slice(0,10)}}</small></div></button>
          <button v-if="hasMore" class="more-link" :disabled="loading" @click="loadNotes(notes.length)">加载更多小记</button>
        </div>
      </div>
      <div v-else class="space-content search-helper"><FileSearch2 :size="25"/><h3>全站检索</h3><p>支持搜索你有权访问的语雀文档。</p><p>Ctrl / ⌘ + K 快速聚焦。</p></div>
      <div class="space-bottom"><span><Wifi v-if="auth.state==='authenticated'" :size="14"/><WifiOff v-else :size="14"/>{{auth.state==='offline'?'离线缓存':'语雀已连接'}}</span><button class="quiet-icon" title="退出账号" @click="signOut"><LogOut :size="16"/></button></div>
    </aside>
    <section class="navigation-panel">
      <template v-if="section==='books'">
        <div class="pane-title"><span class="eyebrow">KNOWLEDGE BASE</span><h2>{{currentBook?.name||'选择知识库'}}</h2><small>{{catalog.length}} 个目录节点</small></div>
        <div class="pane-label"><span>文档目录</span><button class="quiet-icon" title="刷新目录" @click="refresh"><RefreshCw :size="15"/></button></div>
        <div ref="treeScroller" class="tree-scroll" @scroll="scrollTop=($event.target as HTMLElement).scrollTop;viewportHeight=($event.target as HTMLElement).clientHeight">
          <div :style="{height:treeHeight+'px',position:'relative'}">
            <div :style="{position:'absolute',top:offsetTop+'px',width:'100%'}">
              <button v-for="row in virtualRows" :key="row.node.uuid" class="tree-item" :class="{chosen:row.node.doc_id===selectedNode && row.node.type==='DOC',folder:row.node.type!=='DOC'}"
                :style="{paddingLeft:(11+Math.min(row.depth,12)*15)+'px'}" :title="row.node.title" @click="chooseNode(row.node)">
                <ChevronDown v-if="row.node.type!=='DOC' && expanded.has(row.node.uuid)" :size="13"/>
                <ChevronRight v-else-if="row.node.type!=='DOC'" :size="13"/>
                <FileText v-else :size="14"/>
                <span>{{row.node.title||'未命名文档'}}</span>
              </button>
            </div>
          </div>
          <div v-if="loading" class="load-hint"><Loader2 class="spin" :size="17"/> 正在加载目录…</div>
          <div v-else-if="!catalog.length" class="load-hint">此知识库暂无可见目录</div>
        </div>
      </template>
      <template v-else-if="section==='notes'">
        <div class="pane-title"><span class="eyebrow">QUICK NOTES</span><h2>我的小记</h2><small>轻量记录，随时回顾</small></div>
        <div class="empty-pane"><NotebookPen :size="30"/><p>从左侧选择一则小记</p></div>
      </template>
      <template v-else>
        <div class="pane-title"><span class="eyebrow">DISCOVER</span><h2>全文搜索</h2><small>已验证的 /api/zsearch</small></div>
        <div class="space-search global-search"><Search :size="16"/><input id="global-query" v-model="currentQuery" autofocus placeholder="输入关键词…" @input="scheduleSearch" @keydown.enter.prevent="doSearch()" /></div>
        <div class="pane-label"><span>搜索结果</span><small>{{totalHits>=5000?'5000+':totalHits}}</small></div>
        <div class="search-results">
          <button v-for="hit in results" :key="hit.id" class="hit" @click="chooseHit(hit)"><FileText :size="16"/><div><strong>{{hit.title}}</strong><small>{{hit.book_name||'知识库'}} · {{textOnly(hit.abstract||'').slice(0,92)}}</small></div></button>
          <div v-if="loading" class="load-hint"><Loader2 class="spin" :size="17"/> 正在搜索…</div>
          <div v-else-if="!results.length" class="load-hint">输入关键词以搜索文档</div>
        </div>
      </template>
    </section>
    <main class="reader">
      <header class="reader-toolbar"><div class="breadcrumbs"><BookMarked :size="15"/><span>{{section==='notes'?'小记':section==='search'?'搜索':currentBook?.name||'我的知识库'}}</span><ChevronRight :size="14"/><strong>{{documentTitle||'阅读空间'}}</strong></div><div class="reader-actions"><span v-if="stale" class="offline-badge"><WifiOff :size="13"/> 缓存内容</span><button class="quiet-icon" title="刷新" @click="refresh"><RefreshCw :size="16"/></button><button class="quiet-icon" title="切换主题" @click="changeTheme"><Sun v-if="dark" :size="16"/><Moon v-else :size="16"/></button></div></header>
      <div v-if="reading" class="reader-empty"><Loader2 class="spin" :size="28"/><p>正在读取正文…</p></div>
      <template v-else-if="activeDoc||activeNote">
        <div class="reader-heading"><span class="eyebrow"><FileText :size="13"/>{{activeNote?'QUICK NOTE':'DOCUMENT'}}</span><h1>{{documentTitle}}</h1><div class="reader-meta"><span>{{activeDoc?.content_updated_at?.slice(0,10)||activeNote?.updated_at?.slice(0,10)||'语雀'}}</span><span>·</span><span>{{activeDoc?.word_count||activeNote?.word_count||0}} 字</span><span class="readonly-marker"><ShieldCheck :size="13"/> 安全只读</span></div></div>
        <div class="reader-controls"><span><LockKeyhole :size="14"/> 来自语雀 Lake 格式</span><button class="web-button" :disabled="!recordUrl" @click="openWeb">在语雀编辑 <ExternalLink :size="14"/></button></div>
        <div class="reader-frame"><iframe :key="(activeDoc?.id||'n'+activeNote?.id)" class="lake-frame" title="语雀文档内容" sandbox="" referrerpolicy="no-referrer" :srcdoc="frameHtml"></iframe></div>
        <footer class="reader-footer"><span><ShieldCheck :size="13"/> 内容隔离预览 · 禁止脚本执行</span><span>非官方客户端</span></footer>
      </template>
      <div v-else class="reader-empty"><div class="empty-icon"><Sparkles :size="29"/></div><span class="eyebrow">FOCUS ON WHAT MATTERS</span><h2>知识，在这里汇聚。</h2><p>选择左侧的文档、小记或搜索结果，<br/>开始你的沉浸式阅读。</p></div>
    </main>
  </template>
  <div v-if="message" class="toast" role="status"><AlertCircle :size="16"/>{{message}}<button aria-label="关闭通知" @click="message=''"><X :size="15"/></button></div>
</div>
</template>
