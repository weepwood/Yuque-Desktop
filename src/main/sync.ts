import type { DocumentDetail } from '../shared/types'
import type { LocalDatabase } from './database'
import type { YuqueClient } from './yuque'

/** Explicit publish: local drafts survive network failures, conflicts and server roundtrip mismatches. */
export async function publishDraft(
  db: Pick<LocalDatabase, 'draft' | 'saveDoc' | 'deleteDraft'>,
  api: Pick<YuqueClient, 'doc' | 'updateMarkdown'>,
  repoId: number,
  docId: number
): Promise<DocumentDetail> {
  const draft = db.draft(repoId, docId)
  if (!draft) throw new Error('没有待同步的本地草稿')
  const remote = await api.doc(repoId, docId)
  if (!remote.editable) throw new Error('该文档的 Markdown API 不可写，已保留本地草稿')
  if (!remote.baseUpdatedAt || remote.baseUpdatedAt !== draft.baseUpdatedAt) {
    throw new Error('CONFLICT：云端文档已更新。请备份草稿并人工合并，未覆盖云端内容。')
  }
  await api.updateMarkdown(docId, draft.content)
  const latest = await api.doc(repoId, docId)
  if (latest.content !== draft.content) {
    throw new Error('云端回读内容与本地草稿不同；已保留草稿以便核对')
  }
  db.saveDoc(latest)
  db.deleteDraft(docId)
  return latest
}
