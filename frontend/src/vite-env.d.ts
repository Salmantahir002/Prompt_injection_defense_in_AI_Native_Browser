/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getAppVersion: () => Promise<string>
    invoke: (channel: string) => Promise<unknown>
    extractPageContent: () => Promise<null>
    scanWebview: (webContentsId: number) => Promise<unknown>
    runtimeInvoke: (request: { targetId: number; name: string; params: unknown }) => Promise<unknown>
    agentStartTask: (payload: { taskId: string; goal: string; targetId: number; visualFeedback?: boolean }) => Promise<{ ok: boolean; taskId?: string; error?: string }>
    agentStopTask: (taskId?: string) => Promise<{ ok: boolean }>
    onAgentEvent: (listener: (event: any) => void) => () => void
    onAgentRequestOpenTab: (listener: (data: { taskId: string; requestId: string; url?: string }) => void) => () => void
    agentResponseOpenTab: (payload: { requestId: string; targetId: number | null }) => Promise<{ ok: boolean }>
  }
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      allowpopups?: string
      src?: string
    }
  }
}
