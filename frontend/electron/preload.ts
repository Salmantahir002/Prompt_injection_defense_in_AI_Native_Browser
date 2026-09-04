import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { RUNTIME_INVOKE_CHANNEL } from './browserRuntime/runtimeContract.js'

/** Mirrors the shape main.ts sends over 'browser:tab-event' (see BrowserTabEvent in src/vite-env.d.ts). */
type BrowserTabEvent = {
  webContentsId: number
  type: 'did-start-loading' | 'did-stop-loading' | 'did-navigate' | 'did-navigate-in-page' | 'did-fail-load'
  url?: string
  errorCode?: number
  errorDescription?: string
}

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
  // Guest tabs are hosted as main-owned WebContentsViews (see main.ts), keyed
  // by webContents id — never exposed to the renderer as a DOM element.
  browser: {
    createTab: (url: string) => ipcRenderer.invoke('browser:create-tab', url) as Promise<{ webContentsId: number } | null>,
    closeTab: (webContentsId: number) => ipcRenderer.invoke('browser:close-tab', webContentsId) as Promise<void>,
    navigate: (webContentsId: number, url: string) => ipcRenderer.invoke('browser:navigate', webContentsId, url) as Promise<void>,
    goBack: (webContentsId: number) => ipcRenderer.invoke('browser:go-back', webContentsId) as Promise<void>,
    goForward: (webContentsId: number) => ipcRenderer.invoke('browser:go-forward', webContentsId) as Promise<void>,
    reload: (webContentsId: number) => ipcRenderer.invoke('browser:reload', webContentsId) as Promise<void>,
    executeJavaScript: (webContentsId: number, code: string) => ipcRenderer.invoke('browser:execute-javascript', webContentsId, code) as Promise<unknown>,
    // Fire-and-forget: this fires on every resize/tab-switch, an invoke round trip isn't worth it.
    setBounds: (webContentsId: number, bounds: { x: number; y: number; width: number; height: number }) => {
      ipcRenderer.send('browser:set-bounds', webContentsId, bounds)
    },
    onTabEvent: (listener: (event: BrowserTabEvent) => void) => {
      const handler = (_event: IpcRendererEvent, payload: BrowserTabEvent) => listener(payload)
      ipcRenderer.on('browser:tab-event', handler)
      return () => ipcRenderer.removeListener('browser:tab-event', handler)
    },
  },
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
