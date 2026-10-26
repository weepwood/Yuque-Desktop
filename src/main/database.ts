import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { Repo, DocMeta, Draft, DocumentDetail } from '../shared/types'

export class LocalDatabase {
  private db: DatabaseSync
  constructor(baseDir: string) {
    mkdirSync(baseDir, { recursive: true })
    this.db = new DatabaseSync(join(baseDir, 'yuque.sqlite'))
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS repos (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, repo_id INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT);
      CREATE INDEX IF NOT EXISTS docs_repo ON docs(repo_id);
      CREATE TABLE IF NOT EXISTS drafts (
        doc_id INTEGER PRIMARY KEY, repo_id INTEGER NOT NULL, body TEXT NOT NULL,
        base_updated_at TEXT NOT NULL, saved_at TEXT NOT NULL
      );
    `)
  }
  setting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }
  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
  }
  removeSetting(key: string): void { this.db.prepare('DELETE FROM settings WHERE key=?').run(key) }
  saveRepos(items: Repo[]): void {
    this.db.exec('BEGIN')
    try {
      const insert = this.db.prepare('INSERT INTO repos(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      items.forEach(x => insert.run(x.id, JSON.stringify(x)))
      this.db.exec('COMMIT')
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  repos(): Repo[] {
    return (this.db.prepare('SELECT data FROM repos ORDER BY id DESC').all() as {data: string}[]).map(x => JSON.parse(x.data) as Repo)
  }
  saveDocMeta(items: DocMeta[]): void {
    this.db.exec('BEGIN')
    try {
      const insert = this.db.prepare('INSERT INTO docs(id,repo_id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET repo_id=excluded.repo_id,data=excluded.data,updated_at=excluded.updated_at')
      items.forEach(x => {
        const old = this.doc(x.id)
        // Preserve full text when updating list metadata.
        insert.run(x.id, x.book_id, JSON.stringify(old ? { ...old, ...x } : x), x.updated_at || '')
      })
      this.db.exec('COMMIT')
    } catch(e) { this.db.exec('ROLLBACK'); throw e }
  }
  docs(repoId: number): DocMeta[] {
    return (this.db.prepare('SELECT data FROM docs WHERE repo_id=? ORDER BY id DESC').all(repoId) as {data:string}[]).map(x => JSON.parse(x.data) as DocMeta)
  }
  doc(id: number): DocumentDetail | null {
    const row = this.db.prepare('SELECT data FROM docs WHERE id=?').get(id) as {data:string} | undefined
    if (!row) return null
    const data = JSON.parse(row.data) as DocumentDetail
    return typeof data.content === 'string' ? { ...data, source:'cache' } : null
  }
  saveDoc(doc: DocumentDetail): void {
    this.db.prepare('INSERT INTO docs(id,repo_id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET repo_id=excluded.repo_id,data=excluded.data,updated_at=excluded.updated_at')
      .run(doc.id, doc.book_id, JSON.stringify(doc), doc.baseUpdatedAt)
  }
  draft(repoId: number, docId: number): Draft | null {
    const row = this.db.prepare('SELECT repo_id,doc_id,body,base_updated_at,saved_at FROM drafts WHERE repo_id=? AND doc_id=?').get(repoId,docId) as {repo_id:number;doc_id:number;body:string;base_updated_at:string;saved_at:string} | undefined
    return row ? { repoId:row.repo_id, docId:row.doc_id, content:row.body, baseUpdatedAt:row.base_updated_at, savedAt:row.saved_at } : null
  }
  saveDraft(repoId: number, docId: number, content: string, baseUpdatedAt: string): void {
    this.db.prepare(`INSERT INTO drafts(doc_id,repo_id,body,base_updated_at,saved_at) VALUES(?,?,?,?,?)
      ON CONFLICT(doc_id) DO UPDATE SET body=excluded.body,base_updated_at=excluded.base_updated_at,saved_at=excluded.saved_at`)
      .run(docId, repoId, content, baseUpdatedAt, new Date().toISOString())
  }
  deleteDraft(docId: number): void { this.db.prepare('DELETE FROM drafts WHERE doc_id=?').run(docId) }
  draftCount(): number { const row = this.db.prepare('SELECT COUNT(*) AS amount FROM drafts').get() as {amount:number};return row.amount }
  resetForAccount(): void {
    if (this.draftCount() > 0) throw new Error('当前账号存在未同步草稿，请先同步后再切换账号')
    this.db.exec('BEGIN')
    try { this.db.exec('DELETE FROM docs; DELETE FROM repos; DELETE FROM drafts;'); this.db.exec('COMMIT') }
    catch(e) { this.db.exec('ROLLBACK'); throw e }
  }
  close(): void { this.db.close() }
}
