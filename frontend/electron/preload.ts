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
  versions: process.versions,
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
contextBridge.exposeInMainWorld('process', {
  versions: process.versions,
  env: {
    NODE_ENV: process.env.NODE_ENV || 'development',
  },
})

export type ElectronAPI = typeof electronAPI
