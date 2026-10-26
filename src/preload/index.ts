import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '../shared/types'

// Explicit methods only. No generic invoke(), filesystem API or raw Electron objects.
const desktop: DesktopBridge = {
  session: () => ipcRenderer.invoke('yuque:session'),
  connect: input => ipcRenderer.invoke('yuque:connect', input),
  disconnect: () => ipcRenderer.invoke('yuque:disconnect'),
  listRepos: () => ipcRenderer.invoke('yuque:list-repos'),
  listDocs: id => ipcRenderer.invoke('yuque:list-docs', id),
  openDoc: (repoId, docId) => ipcRenderer.invoke('yuque:open-doc', repoId, docId),
  saveDraft: input => ipcRenderer.invoke('yuque:save-draft', input),
  publish: input => ipcRenderer.invoke('yuque:publish', input),
  createDoc: input => ipcRenderer.invoke('yuque:create-doc', input),
  openExternal: url => ipcRenderer.invoke('yuque:open-external', url)
}
contextBridge.exposeInMainWorld('yuque', desktop)
