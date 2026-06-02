import { contextBridge, ipcRenderer } from 'electron'

const allowedInvokeChannels = ['app:get-version'] as const
type InvokeChannel = (typeof allowedInvokeChannels)[number]

const electronAPI = {
  getAppVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
  invoke: (channel: InvokeChannel) => {
    if (!allowedInvokeChannels.includes(channel)) {
      throw new Error(`Blocked IPC channel: ${channel}`)
    }

    return ipcRenderer.invoke(channel) as Promise<unknown>
  },
  extractPageContent: () => Promise.resolve(null),
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
