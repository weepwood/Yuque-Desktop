import type { Session } from 'electron'
import type { Account, Book, CatalogNode, YuqueDocument, NotesPage, Note, NoteTag, SearchResults, Team } from '../shared/session-contract'
import { unwrapResponse } from '../shared/session-contract'

export class YuqueHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'YuqueHttpError' }
}
/**
 * Only GET calls to the nine verified read-only endpoints.
 * Electron's persistent Session holds HttpOnly cookies; the renderer never sees them.
 */
export class InternalYuqueApi {
  constructor(private readonly browserSession: Pick<Session, 'fetch'>) {}
  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(path, 'https://www.yuque.com')
    if (url.origin !== 'https://www.yuque.com' || !url.pathname.startsWith('/api/')) throw new Error('已阻止非语雀接口请求')
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,String(v)))
    const response = await this.browserSession.fetch(url.href, {
      method: 'GET', credentials: 'include', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000)
    })
    if (!response.ok) {
      let message = 'HTTP ' + response.status
      try {
        const data = await response.json() as { message?: string; key?: string }
        message = [data.message, data.key].filter(Boolean).join(' · ') || message
      } catch {}
      if ([401,403].includes(response.status)) message = '会话失效或无权访问 · ' + message
      throw new YuqueHttpError(response.status, message)
    }
    const raw: unknown = await response.json()
    return unwrapResponse<T>(raw)
  }
  mine(): Promise<Account> { return this.get('/api/mine') }
  teams(): Promise<Team[]> { return this.get('/api/mine/groups') }
  books(): Promise<Book[]> { return this.get('/api/mine/books') }
  catalog(bookId: number): Promise<CatalogNode[]> { return this.get('/api/catalog_nodes', { book_id: bookId }) }
  document(bookId: number, docId: number): Promise<YuqueDocument> { return this.get('/api/docs/' + docId, { book_id: bookId }) }
  search(q: string): Promise<SearchResults> { return this.get('/api/zsearch', { q, type: 'doc' }) }
  notes(offset: number, q: string): Promise<NotesPage> {
    return this.get('/api/modules/note/notes/NoteController/index', {
      offset, q, filter_type: 'all', status: 0, merge_dynamic_data: 0,
      order: 'content_updated_at', with_pinned_notes: 'true', limit: 20
    })
  }
  note(id: number): Promise<Note> {
    return this.get('/api/modules/note/notes/NoteController/show', { id, merge_dynamic_data: 0 })
  }
  tags(): Promise<NoteTag[]> { return this.get('/api/modules/note/tags/TagController/index') }
}
