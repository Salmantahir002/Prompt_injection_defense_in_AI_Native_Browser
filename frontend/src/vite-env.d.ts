/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getAppVersion: () => Promise<string>
    invoke: (channel: 'app:get-version' | 'security:scan-webview' | 'agent:runtime:invoke') => Promise<unknown>
    extractPageContent: () => Promise<null>
    scanWebview: (webContentsId: number) => Promise<unknown>
    runtimeInvoke: (request: { targetId: number; name: string; params: unknown }) => Promise<unknown>
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
