/** Internal, undocumented Yuque API response shapes. See docs/internal-api.md. */
export interface Account { id: number; login: string; name: string; avatar_url?: string; memberLevelName?: string }
export interface Team { id: number; login: string; name: string; books_count?: number; public_books_count?: number }
export interface Book { id: number; slug: string; name: string; type: string; items_count?: number; content_updated_at?: string; public?: number; book_icon?: { type: string; url?: string }; user_id?: number }
export interface CatalogNode { id: number; doc_id: number; uuid: string; parent_uuid: string; sibling_uuid: string; child_uuid: string; prev_uuid: string; title: string; url: string; type: 'DOC' | 'TITLE' | string; level: number; visible: number }
export interface YuqueDocument { id: number; book_id: number; slug: string; title: string; content: string; content_updated_at?: string; updated_at?: string; word_count?: number; status?: number; public?: number; user?: { login: string } }
export interface Note { id: number; slug: string; content: { abstract?: string; html?: string; source?: string; format?: string }; word_count?: number; updated_at?: string; pinned_at?: string | null; tags?: string[] }
export interface NotesPage { notes: Note[]; pin_notes: Note[]; has_more: boolean }
export interface NoteTag { id: number; name: string }
export interface SearchHit { id: number; title: string; abstract?: string; url?: string; book_name?: string; slug?: string; _record?: { book_id?: number } }
export interface SearchResults { hits: SearchHit[]; totalHits: number; numHits: number }
export interface Loaded<T> { value: T; stale: boolean; fetchedAt?: number }
export type AuthState = { state: 'signed-out' | 'authenticated' | 'offline'; account?: Account }
export interface YuqueSessionBridge {
  authState(): Promise<AuthState>
  login(): Promise<void>
  logout(): Promise<void>
  books(): Promise<Loaded<Book[]>>
  teams(): Promise<Loaded<Team[]>>
  catalog(bookId: number): Promise<Loaded<CatalogNode[]>>
  document(bookId: number, docId: number): Promise<Loaded<YuqueDocument>>
  search(query: string): Promise<SearchResults>
  notes(offset: number, query: string): Promise<Loaded<NotesPage>>
  note(id: number): Promise<Loaded<Note>>
  tags(): Promise<Loaded<NoteTag[]>>
  openExternal(url: string): Promise<void>
  onAuthChanged(callback: (state: AuthState) => void): () => void
}
/** A successful `data` wrapper must be unwrapped; notes intentionally return a bare object. */
export function unwrapResponse<T>(raw: unknown): T {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('服务端响应格式不正确')
  const object = raw as Record<string, unknown>
  if (typeof object.status === 'number' && object.status >= 400) throw new Error(String(object.message || '语雀接口错误'))
  if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data as T
  return raw as T
}
export function requireId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error('非法资源 ID')
  return value as number
}
export function limitQuery(value: unknown, maximum = 128): string {
  if (typeof value !== 'string' || value.length > maximum) throw new Error('搜索词长度超限')
  return value.trim()
}
