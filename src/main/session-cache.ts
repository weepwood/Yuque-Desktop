import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, Loaded } from '../shared/session-contract'

/** Separate storage from the v0.1.0 database, retaining any old unsynced drafts untouched. */
export class SessionCache {
  private readonly database: DatabaseSync
  constructor(userData: string) {
    mkdirSync(userData, { recursive: true })
    this.database = new DatabaseSync(join(userData, 'yuque-session-cache.sqlite'))
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS cache (
        account_id INTEGER NOT NULL, cache_key TEXT NOT NULL,
        payload TEXT NOT NULL, saved_at INTEGER NOT NULL,
        PRIMARY KEY(account_id, cache_key)
      );
      CREATE TABLE IF NOT EXISTS account (
        key TEXT PRIMARY KEY, payload TEXT NOT NULL
      );
    `)
  }
  account(): Account | undefined {
    const row = this.database.prepare("SELECT payload FROM account WHERE key='last'").get() as { payload: string } | undefined
    return row ? JSON.parse(row.payload) as Account : undefined
  }
  setAccount(account: Account): void {
    this.database.prepare("INSERT INTO account(key,payload) VALUES('last',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload").run(JSON.stringify(account))
  }
  get<T>(id: number, key: string): Loaded<T> | null {
    const row = this.database.prepare('SELECT payload,saved_at FROM cache WHERE account_id=? AND cache_key=?')
      .get(id, key) as { payload: string; saved_at: number } | undefined
    return row ? { value: JSON.parse(row.payload) as T, stale: true, fetchedAt: row.saved_at } : null
  }
  set<T>(id: number, key: string, data: T): Loaded<T> {
    const now = Date.now()
    this.database.prepare('INSERT INTO cache(account_id,cache_key,payload,saved_at) VALUES(?,?,?,?) ON CONFLICT(account_id,cache_key) DO UPDATE SET payload=excluded.payload,saved_at=excluded.saved_at')
      .run(id, key, JSON.stringify(data), now)
    return { value: data, stale: false, fetchedAt: now }
  }
  forgetAccount(id: number): void {
    this.database.prepare('DELETE FROM cache WHERE account_id=?').run(id)
    this.database.prepare("DELETE FROM account WHERE key='last'").run()
  }
  close(): void { this.database.close() }
}
