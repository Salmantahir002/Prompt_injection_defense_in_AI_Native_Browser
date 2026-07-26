/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getAppVersion: () => Promise<string>
    invoke: (channel: 'app:get-version' | 'security:scan-webview') => Promise<unknown>
    extractPageContent: () => Promise<null>
    scanWebview: (webContentsId: number) => Promise<unknown>
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
