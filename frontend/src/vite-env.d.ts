/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getAppVersion: () => Promise<string>
    invoke: (channel: 'app:get-version') => Promise<unknown>
    extractPageContent: () => Promise<null>
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
