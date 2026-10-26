<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { DocMeta, DocumentDetail, Draft, Repo, Session } from '../../shared/types'
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import {
  BookOpen, BookMarked, PanelLeftClose, PanelLeftOpen, Search, Settings2, RefreshCw,
  Sun, Moon, UploadCloud, Check, CloudOff, Wifi, Sparkles, ExternalLink,
  AlertTriangle, FolderOpen, Folder, LoaderCircle, Command, X, KeyRound,
  ShieldCheck, LogOut, Plus, FileText, FileCode2, ChevronRight, PenLine,
  LayoutDashboard, Clock3, MoreHorizontal, ArrowUpRight, CircleHelp, CheckCheck
} from 'lucide-vue-next'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
const connected = ref<Session | null>(null)
const token = ref('')
const host = ref('https://www.yuque.com')
const repos = ref<Repo[]>([])
const docs = ref<DocMeta[]>([])
const selectedRepo = ref<number | null>(null)
const selectedDoc = ref<number | null>(null)
const activeDocument = ref<DocumentDetail | null>(null)
const editorContent = ref('')
const activeDraft = ref<Draft | null>(null)
const modified = ref(false)
const loading = ref(false)
const busy = ref(false)
const connecting = ref(false)
const syncing = ref(false)
const search = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const error = ref('')
const notice = ref('')
const createDialog = ref(false)
const newDocTitle = ref('')
const preview = ref(false)
const collapsed = ref(false)
const dark = ref(localStorage.getItem('yuque-theme') === 'dark')
let saveTimer: ReturnType<typeof setTimeout> | undefined
let toastTimer: ReturnType<typeof setTimeout> | undefined
let selectionGeneration = 0
let mayCloseAfterSaving = false

const isConnected = computed(() => Boolean(connected.value?.connected))
const chosenRepo = computed(() => repos.value.find(r => r.id === selectedRepo.value))
const chosenDoc = computed(() => docs.value.find(d => d.id === selectedDoc.value))
const sortedRepos = computed(() => repos.value)
const filteredDocs = computed(() => docs.value.filter(d => !search.value || d.title.toLowerCase().includes(search.value.toLowerCase())))
const htmlPreview = computed(() => {
  if (!activeDocument.value) return ''
  const html = activeDocument.value.editable ? md.render(editorContent.value) : (activeDocument.value.previewHtml || '<p>此格式暂不支持预览，请到语雀网页查看。</p>')
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
})
const conflict = computed(() => !!(activeDraft.value && activeDocument.value && activeDraft.value.baseUpdatedAt !== activeDocument.value.baseUpdatedAt))
const statusText = computed(() => conflict.value ? '云端版本冲突' : modified.value ? '正在保存草稿…' : activeDraft.value ? '草稿已保存在本地' : activeDocument.value?.source === 'cache' ? '离线缓存' : '已与云端同步')

function toast(message: string): void {
  notice.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => notice.value = '', 4600)
}
function showError(e: unknown): void { error.value = e instanceof Error ? e.message : String(e); toast(error.value) }
function switchTheme(): void {
  dark.value = !dark.value
  localStorage.setItem('yuque-theme', dark.value ? 'dark' : 'light')
  globalThis.document.documentElement.classList.toggle('dark', dark.value)
}

async function bootstrap(): Promise<void> {
  try {
    connected.value = await window.yuque.session()
    host.value = connected.value.host
    if (connected.value.connected) await refreshRepos()
  } catch (e) { showError(e) }
}
async function connect(): Promise<void> {
  if (!token.value.trim()) { toast('请填写个人访问 Token'); return }
  connecting.value = true
  error.value = ''
  try {
    connected.value = await window.yuque.connect({ token: token.value.trim(), host: host.value })
    token.value = ''
    await refreshRepos()
    toast('账号连接成功，Token 已加密保存在本机')
  } catch (e) { showError(e) }
  finally { connecting.value = false }
}
async function disconnect(): Promise<void> {
  try {
    await flushDraft()
    await window.yuque.disconnect()
    connected.value = null
    repos.value = []
    docs.value = []
    activeDocument.value = null
    selectedRepo.value = null
    selectedDoc.value = null
    toast('已断开连接，本地缓存已清理')
  } catch(e) { showError(e) }
}
async function refreshRepos(): Promise<void> {
  if (!isConnected.value) return
  loading.value = true
  try {
    repos.value = await window.yuque.listRepos()
    if (!selectedRepo.value && repos.value.length) await selectRepo(repos.value[0]!.id)
  } catch(e) { showError(e) }
  finally { loading.value = false }
}
async function selectRepo(id: number): Promise<void> {
  if (selectedRepo.value !== id) await flushDraft()
  selectedRepo.value = id
  selectedDoc.value = null
  activeDocument.value = null
  docs.value = []
  loading.value = true
  const generation = ++selectionGeneration
  try {
    const result = await window.yuque.listDocs(id)
    if (generation !== selectionGeneration) return
    docs.value = result
  } catch(e) { showError(e) }
  finally { loading.value = false }
}
async function selectDoc(id: number): Promise<void> {
  if (selectedDoc.value === id) return
  await flushDraft()
  selectedDoc.value = id
  activeDocument.value = null
  editorContent.value = ''
  activeDraft.value = null
  preview.value = false
  busy.value = true
  const generation = ++selectionGeneration
  try {
    const result = await window.yuque.openDoc(selectedRepo.value!, id)
    if (generation !== selectionGeneration) return
    activeDocument.value = result.doc
    activeDraft.value = result.draft
    editorContent.value = result.draft?.content ?? result.doc.content
    modified.value = false
    if (result.draft && result.draft.baseUpdatedAt !== result.doc.baseUpdatedAt) toast('云端已有新的修改，请勿直接覆盖；本地草稿已保留')
  } catch(e) { showError(e) }
  finally { busy.value = false }
}
function onEdit(value: string): void {
  editorContent.value = value
  modified.value = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void flushDraft().catch(showError) }, 650)
}
async function flushDraft(): Promise<void> {
  clearTimeout(saveTimer)
  if (!modified.value || !activeDocument.value || !selectedRepo.value || !selectedDoc.value || !activeDocument.value.editable) return
  const repoId = selectedRepo.value
  const docId = selectedDoc.value
  const body = editorContent.value
  const baseUpdatedAt = activeDraft.value?.baseUpdatedAt || activeDocument.value.baseUpdatedAt
  await window.yuque.saveDraft({ repoId, docId, content: body, baseUpdatedAt })
  activeDraft.value = { repoId, docId, content: body, baseUpdatedAt, savedAt: new Date().toISOString() }
  if (editorContent.value === body && selectedDoc.value === docId) modified.value = false
}
async function publish(): Promise<void> {
  if (!activeDocument.value?.editable) return
  syncing.value = true
  try {
    await flushDraft()
    if (!activeDraft.value) { toast('没有需要同步的改动'); return }
    if (conflict.value) { toast('检测到云端版本冲突，已阻止覆盖'); return }
    const doc = await window.yuque.publish({ repoId: selectedRepo.value!, docId: selectedDoc.value! })
    activeDocument.value = doc
    editorContent.value = doc.content
    activeDraft.value = null
    modified.value = false
    toast('文档已成功同步到语雀')
  } catch(e) { showError(e) }
  finally { syncing.value = false }
}
async function createDoc(): Promise<void> {
  if (!selectedRepo.value || !newDocTitle.value.trim()) return
  busy.value = true
  try {
    const doc = await window.yuque.createDoc({ repoId: selectedRepo.value, title: newDocTitle.value.trim() })
    docs.value = [doc, ...docs.value]
    createDialog.value = false
    newDocTitle.value = ''
    toast('文档已创建到语雀')
    await selectDoc(doc.id)
  } catch(e) { showError(e) }
  finally { busy.value = false }
}
async function openOnYuque(): Promise<void> {
  if (!activeDocument.value || !chosenRepo.value) return
  const namespace = chosenRepo.value.namespace
  if (!namespace || !/^[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(namespace)) { toast('缺少有效的知识库路径'); return }
  const url = `https://www.yuque.com/${namespace}/${encodeURIComponent(activeDocument.value.slug)}`
  try { await window.yuque.openExternal(url) } catch(e) { showError(e) }
}
function onKey(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void publish() }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInput.value?.focus() }
  if (e.key === 'Escape') createDialog.value = false
}
function beforeClose(e: BeforeUnloadEvent): void {
  if (modified.value && !mayCloseAfterSaving) {
    // Cancel first close until the last keystrokes are durable on disk.
    e.preventDefault()
    e.returnValue = false
    void flushDraft().then(() => { mayCloseAfterSaving = true; window.close() }).catch(showError)
  }
}

onMounted(() => {
  globalThis.document.documentElement.classList.toggle('dark', dark.value)
  window.addEventListener('keydown', onKey)
  window.addEventListener('beforeunload', beforeClose)
  void bootstrap()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('beforeunload', beforeClose)
  clearTimeout(saveTimer)
  clearTimeout(toastTimer)
})
</script>

<template>
  <div class="app-shell">
    <aside class="icon-rail">
      <div class="brand-logo" title="Yuque Desktop"><BookOpen :size="23" :stroke-width="2.3" /></div>
      <div class="rail-items">
        <button class="rail-button active" title="工作台"><LayoutDashboard :size="19" /></button>
        <button class="rail-button" title="知识库"><BookMarked :size="19" /></button>
        <button class="rail-button" title="收起导航" @click="collapsed = !collapsed">
          <PanelLeftOpen v-if="collapsed" :size="19" /><PanelLeftClose v-else :size="19" />
        </button>
      </div>
      <div class="rail-bottom">
        <button class="rail-button" :title="dark ? '浅色主题' : '深色主题'" @click="switchTheme"><Sun v-if="dark" :size="19" /><Moon v-else :size="19" /></button>
        <div class="rail-account" :title="connected?.user?.name || '未连接'">{{ connected?.user?.name?.slice(0,1).toUpperCase() || 'Y' }}</div>
      </div>
    </aside>

    <template v-if="!isConnected">
      <main class="onboarding-area">
        <div class="onboarding-top"><div class="pill"><span class="live-dot"></span> Local-first workspace</div><span class="version">v0.1.0 · Electron</span></div>
        <div class="welcome-layout">
          <div class="welcome-copy">
            <div class="welcome-icon"><Sparkles :size="23" /></div>
            <div class="eyebrow">YOUR KNOWLEDGE, REIMAGINED</div>
            <h1>知识触手可及<span class="period">.</span></h1>
            <p>一个更轻盈、更专注的语雀桌面空间。<br>快速浏览知识库，安心编辑，离线保留每一次思考。</p>
            <div class="features">
              <span><Check :size="15" /> 本地优先</span>
              <span><Check :size="15" /> 安全存储</span>
              <span><Check :size="15" /> 手动云端同步</span>
            </div>
          </div>
          <form class="connect-card" @submit.prevent="connect">
            <div class="connect-icon"><KeyRound :size="22" /></div>
            <h2>连接你的语雀</h2>
            <p>使用个人访问 Token 连接已有知识库，不收集登录密码。</p>
            <label for="host">语雀服务地址</label>
            <input id="host" v-model="host" autocomplete="off" spellcheck="false" placeholder="https://www.yuque.com" />
            <label for="token">个人访问 Token</label>
            <input id="token" v-model="token" type="password" spellcheck="false" autocomplete="off" placeholder="粘贴你的语雀 Token" />
            <button class="primary-btn connect-btn" type="submit" :disabled="connecting">
              <LoaderCircle v-if="connecting" class="spin" :size="17" />
              <span>{{ connecting ? '正在验证连接…' : '连接语雀' }}</span>
              <ArrowUpRight v-if="!connecting" :size="17" />
            </button>
            <div class="safe-note"><ShieldCheck :size="16" /> Token 使用系统凭据加密，仅保存在当前设备</div>
            <p v-if="error" class="inline-error">{{ error }}</p>
          </form>
        </div>
        <div class="onboarding-footer"><span>由你掌控的数据，值得更好的工具。</span><span>Windows · macOS</span></div>
      </main>
    </template>

    <template v-else>
      <aside v-if="!collapsed" class="library-panel">
        <div class="panel-head"><span>工作空间</span><button class="icon-button" title="刷新知识库" @click="refreshRepos"><RefreshCw :size="16" :class="{ spin: loading }" /></button></div>
        <div class="account-card"><div class="account-avatar">{{ connected?.user?.name?.slice(0,1).toUpperCase() || 'Y' }}</div><div><strong>{{ connected?.user?.name }}</strong><span>@{{ connected?.user?.login }}</span></div><div class="account-online"></div></div>
        <div class="section-heading"><span>知识库</span><span class="count">{{ repos.length }}</span></div>
        <div class="repo-list">
          <button v-for="r in sortedRepos" :key="r.id" class="repo-item" :class="{ chosen: selectedRepo === r.id }" @click="selectRepo(r.id)"><FolderOpen v-if="selectedRepo === r.id" :size="16" /><Folder v-else :size="16" /><span>{{ r.name }}</span><ChevronRight v-if="selectedRepo === r.id" :size="15" /></button>
          <div v-if="!repos.length" class="empty-small">尚无知识库或无法获取数据</div>
        </div>
        <div class="library-bottom"><div class="connection"><span class="live-dot"></span> 已连接语雀 <Wifi :size="13" /></div><button class="signout" title="断开连接" @click="disconnect"><LogOut :size="16" /></button></div>
      </aside>

      <section class="documents-panel">
        <div class="documents-header"><div><span class="overline">KNOWLEDGE BASE</span><h2>{{ chosenRepo?.name || '我的知识库' }}</h2></div><button class="icon-button" title="新建文档" :disabled="!chosenRepo" @click="createDialog = true"><Plus :size="19" /></button></div>
        <div class="search-wrap"><Search :size="16" /><input ref="searchInput" v-model="search" placeholder="搜索当前文档..." aria-label="搜索文档" /><span class="shortcut">⌘K</span></div>
        <div class="docs-label"><span>全部文档</span><span>{{ filteredDocs.length }}</span></div>
        <div class="doc-list">
          <button v-for="d in filteredDocs" :key="d.id" class="doc-entry" :class="{ selected: selectedDoc === d.id }" @click="selectDoc(d.id)"><span class="doc-symbol"><FileText :size="16" /></span><span class="doc-content"><span class="doc-name">{{ d.title }}</span><span class="doc-date">{{ d.updated_at ? new Date(d.updated_at).toLocaleDateString('zh-CN') : '云端文档' }}</span></span></button>
          <div v-if="loading" class="empty-small"><LoaderCircle class="spin" :size="16" /> 正在加载...</div>
          <div v-else-if="!docs.length" class="empty-small"><BookOpen :size="26" /> 当前知识库没有文档</div>
          <div v-else-if="!filteredDocs.length" class="empty-small">没有匹配的文档</div>
        </div>
        <div class="docs-footer"><span><Clock3 :size="13" /> 本地缓存已启用</span><Settings2 :size="15" /></div>
      </section>

      <main class="editor-area">
        <header class="editor-toolbar"><div class="breadcrumbs"><BookMarked :size="15" /><span>{{ chosenRepo?.name || '知识库' }}</span><ChevronRight :size="14" /><strong>{{ chosenDoc?.title || '开始阅读' }}</strong></div><div class="toolbar-actions"><button class="icon-button" title="切换主题" @click="switchTheme"><Moon v-if="!dark" :size="17" /><Sun v-else :size="17" /></button><button class="icon-button" title="刷新知识库" @click="refreshRepos"><RefreshCw :size="16" /></button></div></header>

        <div v-if="busy" class="editor-placeholder"><LoaderCircle class="spin" :size="24" /><h3>正在加载文档...</h3></div>
        <div v-else-if="!activeDocument" class="editor-placeholder"><div class="placeholder-orbit"><BookOpen :size="33" /></div><div class="placeholder-pill">YOUR WORKSPACE</div><h2>让每一个想法，都有归处</h2><p>从左侧选择一篇文档，开启专注的阅读与创作体验。</p><button class="outline-button" :disabled="!chosenRepo" @click="createDialog=true"><Plus :size="16" /> 新建文档</button></div>
        <template v-else>
          <div class="document-header"><div class="document-overline"><FileCode2 :size="14" /> {{ activeDocument.editable ? 'MARKDOWN DOCUMENT' : 'READ-ONLY DOCUMENT' }}</div><h1>{{ activeDocument.title }}</h1><div class="document-meta"><span><Clock3 :size="14" /> {{ activeDocument.updated_at ? new Date(activeDocument.updated_at).toLocaleString('zh-CN') : '未提供更新时间' }}</span><span class="meta-dot">·</span><span>{{ activeDocument.format || '未知格式' }}</span><span class="meta-dot">·</span><span>{{ editorContent.length }} 字符</span></div></div>
          <div class="doc-actionbar"><div class="mode-switch"><button :class="{ active: !preview }" :disabled="!activeDocument.editable" @click="preview=false"><PenLine :size="15" /> 编辑</button><button :class="{ active: preview || !activeDocument.editable }" @click="preview=true"><BookOpen :size="15" /> 预览</button></div><div class="editor-right"><span class="save-indicator" :class="{ 'conflict-indicator': conflict }"><AlertTriangle v-if="conflict" :size="14" /><CloudOff v-else-if="activeDocument.source === 'cache'" :size="14" /><CheckCheck v-else :size="15" /> {{ statusText }}</span><button class="icon-button" title="在语雀打开" @click="openOnYuque"><ExternalLink :size="16" /></button><button class="primary-btn publish-btn" :disabled="syncing || !activeDocument.editable || conflict || !(modified || activeDraft)" @click="publish"><LoaderCircle v-if="syncing" class="spin" :size="15" /><UploadCloud v-else :size="15" /> 同步到语雀</button></div></div>
          <div v-if="conflict" class="conflict-banner"><AlertTriangle :size="17" /><div><strong>检测到版本冲突</strong><span>语雀云端已被其他客户端修改。当前编辑稿保留在本地，禁止直接覆盖。</span></div></div>
          <div v-if="!activeDocument.editable" class="readonly-banner"><ShieldCheck :size="17" /><span>当前文档不是可安全写回的 Markdown/YFM 格式。已关闭编辑，避免损坏语雀原文。</span></div>
          <div class="document-surface" :class="{ 'preview-surface': preview || !activeDocument.editable }">
            <div v-if="preview || !activeDocument.editable" class="markdown-body" v-html="htmlPreview"></div>
            <textarea v-else class="markdown-input" spellcheck="false" :value="editorContent" @input="onEdit(($event.target as HTMLTextAreaElement).value)" @blur="flushDraft()" aria-label="Markdown 编辑器"></textarea>
          </div>
          <div class="editor-statusbar"><span><span class="live-dot" :class="{ 'danger-dot': conflict }"></span>{{ activeDocument.source === 'cache' ? '离线缓存' : '语雀 API 已连接' }}</span><span>UTF-8 <span class="meta-dot">·</span> Markdown <span class="meta-dot">·</span> {{ activeDocument.editable ? 'Ctrl / ⌘ + S 同步' : '只读模式' }}</span></div>
        </template>
      </main>
    </template>

    <div v-if="notice" class="toast" role="status"><CircleHelp :size="18" /><span>{{ notice }}</span><button @click="notice=''" aria-label="关闭消息"><X :size="14" /></button></div>
    <div v-if="createDialog" class="modal-backdrop" @click.self="createDialog=false"><form class="modal-card" @submit.prevent="createDoc"><div class="modal-head"><div class="modal-symbol"><FileText :size="19" /></div><button type="button" class="icon-button" @click="createDialog=false"><X :size="17" /></button></div><h2>新建文档</h2><p>将在「{{ chosenRepo?.name }}」知识库创建一篇 Markdown 文档，立即同步到语雀。</p><label for="newDocTitle">文档标题</label><input id="newDocTitle" v-model="newDocTitle" autofocus maxlength="200" placeholder="为你的新文档命名" /><div class="modal-actions"><button type="button" class="outline-button" @click="createDialog=false">取消</button><button type="submit" class="primary-btn" :disabled="busy || !newDocTitle.trim()"><Plus :size="16" /> 创建文档</button></div></form></div>
  </div>
</template>
