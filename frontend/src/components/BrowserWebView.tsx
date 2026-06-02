import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { WebpageContent } from '../types/securityTypes'

type WebViewDomElement = HTMLElement & {
  canGoBack: () => boolean
  canGoForward: () => boolean
  executeJavaScript: (code: string) => Promise<unknown>
  getURL: () => string
  goBack: () => void
  goForward: () => void
  loadURL: (url: string) => Promise<void>
  reload: () => void
  src: string
}

type NavigationEvent = Event & {
  errorCode?: number
  errorDescription?: string
  url?: string
}

export type BrowserWebViewHandle = {
  extractContent: () => Promise<WebpageContent | null>
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

const EXTRACT_CONTENT_SCRIPT = `
(function() {
  function getComments(root) {
    var comments = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, null, false);
    var node;
    while (node = walker.nextNode()) { comments.push(node.nodeValue || ''); }
    return comments.join(' ');
  }

  function getHidden() {
    var hidden = [];
    document.querySelectorAll('[hidden],[aria-hidden="true"]').forEach(function(el) {
      if (el.textContent) hidden.push(el.textContent.trim());
    });
    document.querySelectorAll('[style]').forEach(function(el) {
      var s = el.getAttribute('style') || '';
      if (s.includes('display:none') || s.includes('display: none') ||
          s.includes('visibility:hidden') || s.includes('visibility: hidden')) {
        if (el.textContent) hidden.push(el.textContent.trim());
      }
    });
    return hidden.join(' ');
  }

  function getMeta() {
    var metas = [];
    document.querySelectorAll('meta[content]').forEach(function(m) {
      metas.push(m.getAttribute('content'));
    });
    return metas.join(' ');
  }

  function getInputs() {
    var inputs = [];
    document.querySelectorAll('input,textarea').forEach(function(el) {
      var v = el.value || el.textContent || '';
      if (v.trim()) inputs.push(v.trim());
    });
    return inputs.join(' ');
  }

  return {
    visible_text: document.body ? document.body.innerText.substring(0, 50000) : '',
    hidden_text: getHidden().substring(0, 10000),
    html_comments: getComments(document).substring(0, 10000),
    meta_tags: getMeta().substring(0, 5000),
    input_values: getInputs().substring(0, 5000),
    page_title: document.title || '',
    url: location.href || ''
  };
})()
`

export const BrowserWebView = forwardRef<BrowserWebViewHandle, BrowserWebViewProps>(
  function BrowserWebView({ initialUrl, onLoadingChange, onNavigate }, ref) {
    const webviewRef = useRef<WebViewDomElement | null>(null)
    const [activeUrl, setActiveUrl] = useState(initialUrl)
    const [errorMessage, setErrorMessage] = useState('')
    const isElectronRuntime = Boolean(window.electronAPI)

    const setWebviewRef = useCallback((element: HTMLElement | null) => {
      webviewRef.current = element as WebViewDomElement | null
    }, [])

    useImperativeHandle(ref, () => ({
      extractContent: async () => {
        if (!webviewRef.current) return null
        try {
          const result = await webviewRef.current.executeJavaScript(EXTRACT_CONTENT_SCRIPT)
          return result as WebpageContent
        } catch {
          return null
        }
      },
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
        if (webviewRef.current) {
          webviewRef.current.src = url
        }
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
        <webview
          ref={setWebviewRef}
          className="browser-webview"
          src={activeUrl}
          allowpopups={false}
        />
        {errorMessage ? <div className="webview-error" role="alert">{errorMessage}</div> : null}
      </section>
    )
  },
)
