import { contextBridge, ipcRenderer } from 'electron'
import type { YuqueSessionBridge, AuthState } from '../shared/session-contract'

const bridge: YuqueSessionBridge = {
  authState:()=>ipcRenderer.invoke('yuque:auth-state'),
  login:()=>ipcRenderer.invoke('yuque:login'),
  logout:()=>ipcRenderer.invoke('yuque:logout'),
  books:()=>ipcRenderer.invoke('yuque:books'),
  teams:()=>ipcRenderer.invoke('yuque:teams'),
  catalog:(bookId)=>ipcRenderer.invoke('yuque:catalog',bookId),
  document:(bookId,docId)=>ipcRenderer.invoke('yuque:document',bookId,docId),
  search:(query)=>ipcRenderer.invoke('yuque:search',query),
  notes:(offset,query)=>ipcRenderer.invoke('yuque:notes',offset,query),
  note:(id)=>ipcRenderer.invoke('yuque:note',id),
  tags:()=>ipcRenderer.invoke('yuque:tags'),
  openExternal:(url)=>ipcRenderer.invoke('yuque:open-external',url),
  onAuthChanged:(callback)=>{
    const listener=(_event:Electron.IpcRendererEvent,state:AuthState):void=>callback(state)
    ipcRenderer.on('yuque:auth-changed',listener)
    return ()=>ipcRenderer.removeListener('yuque:auth-changed',listener)
  }
}
contextBridge.exposeInMainWorld('yuque',bridge)
