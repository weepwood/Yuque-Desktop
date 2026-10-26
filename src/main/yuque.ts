import type { DocMeta, DocumentDetail, Repo, YuqueUser } from '../shared/types'

export function normalizeHost(value: string): string {
  const url = new URL((value || 'https://www.yuque.com').trim())
  // Only official Yuque domains are permitted in this MVP; no credentials or arbitrary hosts.
  if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*yuque\.com$/i.test(url.hostname) || url.port || url.username || url.password) {
    throw new Error('仅允许 HTTPS 语雀官方域名（*.yuque.com）')
  }
  if (url.search || url.hash || !['/', '/api/v2', '/api/v2/'].includes(url.pathname)) {
    throw new Error('请输入语雀站点地址，例如 https://www.yuque.com')
  }
  return `${url.origin}/api/v2`
}

function naturalId(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('无效的资源 ID')
  return String(id)
}

function asDoc(x: Record<string, unknown>, repoId: number): DocMeta {
  return {
    id: Number(x.id), book_id: repoId,
    title: String(x.title || '未命名文档'), slug: String(x.slug || ''),
    format: String(x.format || ''), updated_at: String(x.updated_at || ''),
    word_count: Number(x.word_count || 0)
  }
}

export class YuqueClient {
  constructor(readonly host: string, private readonly token: string) {}

  private async request<T>(path: string, init: RequestInit = {}, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(this.host + path)
    Object.entries(query).forEach(([key, val]) => url.searchParams.set(key, String(val)))
    let last: unknown
    for (let attempt = 0; attempt < (init.method ? 1 : 2); attempt++) {
      try {
        const response = await fetch(url, {
          ...init,
          headers: { 'X-Auth-Token': this.token, Accept: 'application/json', 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
          redirect: 'error'
        })
        if (!response.ok) {
          if (response.status === 401) throw new Error('401：Token 无效或已过期')
          if (response.status === 403) throw new Error('403：当前 Token 没有此操作权限')
          if (response.status === 429) throw new Error('429：语雀 API 访问频率限制，请稍后重试')
          throw new Error(`语雀 API 返回 HTTP ${response.status}`)
        }
        const json = await response.json() as { data: T; message?: string }
        if (json.data === undefined) throw new Error(json.message || 'API 未返回 data 字段')
        return json.data
      } catch (e) {
        last = e
        if (init.method || attempt > 0 || /^(401|403|429)/.test(String((e as Error).message))) break
      }
    }
    throw last
  }

  async user(): Promise<YuqueUser> {
    return this.request<YuqueUser>('/user')
  }

  async repositories(login: string): Promise<Repo[]> {
    if (!/^[a-zA-Z0-9_-]+$/.test(login)) throw new Error('无效的用户 login')
    const result = await this.request<Repo[]>(`/users/${encodeURIComponent(login)}/repos`, {}, { offset: 0, limit: 100 })
    return result.map(x => ({ id: x.id, name: x.name, slug: x.slug, namespace: x.namespace, items_count: x.items_count }))
  }

  async docs(repoId: number): Promise<DocMeta[]> {
    const result = await this.request<Array<Record<string, unknown>>>(`/repos/${naturalId(repoId)}/docs`, {}, { offset: 0, limit: 100 })
    return result.map(x => asDoc(x, repoId))
  }

  async doc(repoId: number, docId: number): Promise<DocumentDetail> {
    // Legacy metadata is required so Lake cannot be mistaken for Markdown.
    const legacy = await this.request<Record<string, unknown>>(`/repos/${naturalId(repoId)}/docs/${naturalId(docId)}`)
    const meta = asDoc(legacy, repoId)
    const format = String(legacy.format || 'lake').toLowerCase()
    if (format === 'markdown') {
      try {
        const ymd = await this.request<{ yfm: string; updated_at: string }>('/yfm/docs', {}, { doc_id: docId })
        return { ...meta, format, content: ymd.yfm ?? '', baseUpdatedAt: ymd.updated_at || meta.updated_at || '', editable: true, source: 'remote' }
      } catch {
        // A Markdown document without a functioning YFM path remains read-only.
        return { ...meta, format, content: String(legacy.body || ''), baseUpdatedAt: meta.updated_at || '', editable: false, source: 'remote', previewHtml: String(legacy.body_html || '') }
      }
    }
    return {
      ...meta, format, content: String(legacy.body_lake || legacy.body || ''),
      baseUpdatedAt: meta.updated_at || '', editable: false, source: 'remote',
      previewHtml: String(legacy.body_html || '')
    }
  }

  async create(repoId: number, title: string): Promise<DocMeta> {
    if (!title.trim() || title.length > 200) throw new Error('标题长度应在 1–200 字之间')
    const created = await this.request<Record<string, unknown>>(`/repos/${naturalId(repoId)}/docs`, {
      method: 'POST', body: JSON.stringify({ title: title.trim(), format: 'markdown', body: `# ${title.trim()}\n` })
    })
    return asDoc(created, repoId)
  }

  async updateMarkdown(docId: number, yfm: string): Promise<{ updated_at: string }> {
    return this.request<{ updated_at: string }>('/yfm/docs', { method: 'PUT', body: JSON.stringify({ doc_id: docId, yfm }) })
  }
}
