export type YuqueUser = { id: number; login: string; name: string; avatar_url?: string }
export type Repo = { id: number; name: string; slug: string; namespace?: string; description?: string; items_count?: number; updated_at?: string }
export type DocMeta = { id: number; book_id: number; title: string; slug: string; format?: string; updated_at?: string; word_count?: number }
export type DocumentDetail = DocMeta & {
  content: string
  baseUpdatedAt: string
  editable: boolean
  previewHtml?: string
  source: 'remote' | 'cache'
}
export type Draft = { repoId: number; docId: number; content: string; baseUpdatedAt: string; savedAt: string }
export type Session = { connected: boolean; user?: YuqueUser; host: string }
export type Workspace = { repos: Repo[]; docs: DocMeta[] }
export interface DesktopBridge {
  session(): Promise<Session>
  connect(input: { token: string; host: string }): Promise<Session>
  disconnect(): Promise<void>
  listRepos(): Promise<Repo[]>
  listDocs(repoId: number): Promise<DocMeta[]>
  openDoc(repoId: number, docId: number): Promise<{ doc: DocumentDetail; draft: Draft | null }>
  saveDraft(input: { repoId: number; docId: number; content: string; baseUpdatedAt: string }): Promise<void>
  publish(input: { repoId: number; docId: number }): Promise<DocumentDetail>
  createDoc(input: { repoId: number; title: string }): Promise<DocMeta>
  openExternal(url: string): Promise<void>
}
