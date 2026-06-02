import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

type WebViewDomElement = HTMLElement & {
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  goBack: () => void
  goForward: () => void
  loadURL: (url: string) => void
  reload: () => void
}

type NavigationEvent = Event & {
  errorCode?: number
  errorDescription?: string
  url?: string
}

export type BrowserWebViewHandle = {
  getURL: () => string
  goBack: () => void
  goForward: () => void
  loadURL: (url: string) => void
  reload: () => void
}

type BrowserWebViewProps = {
  initialUrl: string
  onLoadingChange: (isLoading: boolean) => void
  onNavigate: (url: string) => void
}

export const BrowserWebView = forwardRef<BrowserWebViewHandle, BrowserWebViewProps>(
  function BrowserWebView({ initialUrl, onLoadingChange, onNavigate }, ref) {
    const webviewRef = useRef<WebViewDomElement | null>(null)
    const [activeUrl, setActiveUrl] = useState(initialUrl)
    const [errorMessage, setErrorMessage] = useState('')
    const isElectronRuntime = Boolean(window.electronAPI)

    useImperativeHandle(ref, () => ({
      getURL: () => webviewRef.current?.getURL() ?? activeUrl,
      goBack: () => {
        if (webviewRef.current?.canGoBack()) {
          webviewRef.current.goBack()
        }
      },
      goForward: () => {
        if (webviewRef.current?.canGoForward()) {
          webviewRef.current.goForward()
        }
      },
      loadURL: (url: string) => {
        setErrorMessage('')
        setActiveUrl(url)
        webviewRef.current?.loadURL(url)
      },
      reload: () => {
        webviewRef.current?.reload()
      },
    }), [activeUrl])

    useEffect(() => {
      if (!isElectronRuntime || !webviewRef.current) {
        return undefined
      }

      const webview = webviewRef.current
      const handleStartLoading = () => onLoadingChange(true)
      const handleStopLoading = () => onLoadingChange(false)
      const handleNavigate = (event: Event) => {
        const nextUrl = (event as NavigationEvent).url
        if (nextUrl) {
          setActiveUrl(nextUrl)
          onNavigate(nextUrl)
        }
      }
      const handleFailure = (event: Event) => {
        const failure = event as NavigationEvent
        if (failure.errorCode === -3) {
          return
        }

        setErrorMessage(failure.errorDescription ?? 'Page failed to load')
        onLoadingChange(false)
      }

      webview.addEventListener('did-start-loading', handleStartLoading)
      webview.addEventListener('did-stop-loading', handleStopLoading)
      webview.addEventListener('did-navigate', handleNavigate)
      webview.addEventListener('did-navigate-in-page', handleNavigate)
      webview.addEventListener('did-fail-load', handleFailure)

      return () => {
        webview.removeEventListener('did-start-loading', handleStartLoading)
        webview.removeEventListener('did-stop-loading', handleStopLoading)
        webview.removeEventListener('did-navigate', handleNavigate)
        webview.removeEventListener('did-navigate-in-page', handleNavigate)
        webview.removeEventListener('did-fail-load', handleFailure)
      }
    }, [isElectronRuntime, onLoadingChange, onNavigate])

    if (!isElectronRuntime) {
      return (
        <section className="webview-stage" aria-label="Browser web view">
          <iframe className="browser-iframe" src={activeUrl} title="Browser preview" />
          <div className="webview-note">Electron webview activates inside desktop app.</div>
        </section>
      )
    }

    return (
      <section className="webview-stage" aria-label="Browser web view">
        <webview ref={webviewRef} className="browser-webview" src={activeUrl} allowpopups={false} />
        {errorMessage ? <div className="webview-error" role="alert">{errorMessage}</div> : null}
      </section>
    )
  },
)
