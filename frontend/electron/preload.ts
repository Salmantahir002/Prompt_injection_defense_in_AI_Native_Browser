import { contextBridge, ipcRenderer } from 'electron'
import { RUNTIME_INVOKE_CHANNEL } from './browserRuntime/runtimeContract.js'

const allowedInvokeChannels = [
  'app:get-version',
  'security:scan-webview',
  'agent:start-task',
  'agent:stop-task',
  'agent:response-open-tab',
  'stagehand:status',
  'stagehand:test-connect',
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
  agentStartTask: (payload: { taskId: string; goal: string; targetId: number; visualFeedback?: boolean }) =>
    ipcRenderer.invoke('agent:start-task', payload) as Promise<{ ok: boolean; taskId?: string; error?: string }>,
  agentStopTask: (taskId?: string) =>
    ipcRenderer.invoke('agent:stop-task', taskId) as Promise<{ ok: boolean }>,
  agentResponseOpenTab: (payload: { requestId: string; targetId: number | null }) =>
    ipcRenderer.invoke('agent:response-open-tab', payload) as Promise<{ ok: boolean }>,
  onAgentEvent: (listener: (event: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => listener(data)
    ipcRenderer.on('agent:task-event', handler)
    return () => {
      ipcRenderer.removeListener('agent:task-event', handler)
    }
  },
  onAgentRequestOpenTab: (listener: (data: { taskId: string; requestId: string; url?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => listener(data)
    ipcRenderer.on('agent:request-open-tab', handler)
    return () => {
      ipcRenderer.removeListener('agent:request-open-tab', handler)
    }
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
