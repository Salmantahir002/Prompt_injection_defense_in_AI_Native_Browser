/// <reference types="vite/client" />

/** Pushed from main for the tab whose guest content the event happened on. */
type BrowserTabEvent = {
  webContentsId: number
  type: 'did-start-loading' | 'did-stop-loading' | 'did-navigate' | 'did-navigate-in-page' | 'did-fail-load'
  url?: string
  errorCode?: number
  errorDescription?: string
}

interface Window {
  electronAPI?: {
    getAppVersion: () => Promise<string>
    invoke: (channel: string) => Promise<unknown>
    extractPageContent: () => Promise<null>
    scanWebview: (webContentsId: number) => Promise<unknown>
    runtimeInvoke: (request: { targetId: number; name: string; params: unknown }) => Promise<unknown>
    // Guest tabs are hosted as main-owned WebContentsViews; the renderer only
    // ever addresses one by its webContents id. See BrowserWebView.tsx.
    browser: {
      createTab: (url: string) => Promise<{ webContentsId: number } | null>
      closeTab: (webContentsId: number) => Promise<void>
      navigate: (webContentsId: number, url: string) => Promise<void>
      goBack: (webContentsId: number) => Promise<void>
      goForward: (webContentsId: number) => Promise<void>
      reload: (webContentsId: number) => Promise<void>
      executeJavaScript: (webContentsId: number, code: string) => Promise<unknown>
      setBounds: (webContentsId: number, bounds: { x: number; y: number; width: number; height: number }) => void
      onTabEvent: (listener: (event: BrowserTabEvent) => void) => () => void
    }
  }
}
