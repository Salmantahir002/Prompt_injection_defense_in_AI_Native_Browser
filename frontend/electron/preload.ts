import { contextBridge, ipcRenderer } from 'electron'
import { RUNTIME_INVOKE_CHANNEL } from './browserRuntime/runtimeContract.js'

const allowedInvokeChannels = ['app:get-version', 'security:scan-webview', RUNTIME_INVOKE_CHANNEL] as const
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
  scanWebview: (webContentsId: number) => ipcRenderer.invoke('security:scan-webview', webContentsId) as Promise<unknown>,
  runtimeInvoke: (request: unknown) => ipcRenderer.invoke(RUNTIME_INVOKE_CHANNEL, request) as Promise<unknown>,
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
