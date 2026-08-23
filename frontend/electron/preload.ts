import { contextBridge, ipcRenderer } from 'electron'
import { RUNTIME_INVOKE_CHANNEL } from './browserRuntime/runtimeContract.js'

const allowedInvokeChannels = [
  'app:get-version',
  'security:scan-webview',
  'providers:get-all',
  'providers:save',
  'providers:delete',
  'providers:set-active',
  'providers:get-active',
  RUNTIME_INVOKE_CHANNEL,
] as const
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
  // Secure Provider Storage APIs
  providers: {
    getAll: () => ipcRenderer.invoke('providers:get-all') as Promise<any[]>,
    save: (config: any) => ipcRenderer.invoke('providers:save', config) as Promise<any>,
    delete: (providerId: string) => ipcRenderer.invoke('providers:delete', providerId) as Promise<{ ok: boolean }>,
    setActive: (payload: { id: string | null; selected_model?: string }) =>
      ipcRenderer.invoke('providers:set-active', payload) as Promise<{ ok: boolean }>,
    getActive: () => ipcRenderer.invoke('providers:get-active') as Promise<any>,
  },
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
