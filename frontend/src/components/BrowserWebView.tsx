import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from 'react'
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
  isActive: boolean
  tabId: string
  onLoadingChange: (tabId: string, isLoading: boolean) => void
  onNavigate: (tabId: string, url: string) => void
  onSearch: (tabId: string, query: string) => void
}

const HOMEPAGE_URL = 'about:blank'

type HomePageProps = {
  onSearch: (query: string) => void
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

function HomePage({ onSearch }: HomePageProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestionResult, setSuggestionResult] = useState({
    query: '',
    suggestions: [] as string[],
  })

  useEffect(() => {
    if (isSearchOpen) {
      inputRef.current?.focus()
    }
  }, [isSearchOpen])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) {
      return undefined
    }

    const controller = new AbortController()
    const requestId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        )
        const data: unknown = await response.json()
        const nextSuggestions = Array.isArray(data) && Array.isArray(data[1])
          ? data[1].filter((item): item is string => typeof item === 'string').slice(0, 5)
          : []
        setSuggestionResult({ query, suggestions: nextSuggestions })
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setSuggestionResult({ query, suggestions: [] })
        }
      }
    }, 180)

    return () => {
      controller.abort()
      window.clearTimeout(requestId)
    }
  }, [searchQuery])

  const fallbackSuggestions = searchQuery.trim()
    ? [searchQuery.trim(), `${searchQuery.trim()} news`, `${searchQuery.trim()} latest`]
    : []
  const visibleSuggestions = suggestionResult.query === searchQuery.trim() && suggestionResult.suggestions.length > 0
    ? suggestionResult.suggestions
    : fallbackSuggestions

  function submitSearch(query = searchQuery) {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      return
    }

    onSearch(trimmedQuery)
    setIsSearchOpen(false)
  }

  function dismissSearch() {
    setIsSearchOpen(false)
    setSearchQuery('')
    setSuggestionResult({ query: '', suggestions: [] })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submitSearch()
  }

  return (
    <div className={`homepage-message ${isSearchOpen ? 'homepage-message--search-open' : ''}`}>
      <div className="homepage-content">
        <p>Explore boldly—Prompt Defense quietly shields every page from hidden instruction attacks.</p>
        <button className="homepage-start-button" type="button" onClick={() => setIsSearchOpen(true)}>
          Start browsing
          <ArrowIcon />
        </button>
      </div>

      {isSearchOpen ? (
        <button
          className="homepage-search-backdrop"
          type="button"
          aria-label="Close search"
          onClick={dismissSearch}
        />
      ) : null}

      {isSearchOpen ? (
        <div className="homepage-search-popup" role="dialog" aria-modal="true" aria-label="Search Google">
          <form onSubmit={handleSubmit}>
            <SearchIcon />
            <input
              ref={inputRef}
              aria-autocomplete="list"
              aria-controls="homepage-search-suggestions"
              aria-expanded={visibleSuggestions.length > 0}
              autoComplete="off"
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  dismissSearch()
                }
              }}
              placeholder="Search anything"
              value={searchQuery}
            />
            <button className="homepage-search-submit" type="submit" aria-label="Search Google">
              <ArrowIcon />
            </button>
          </form>
          {visibleSuggestions.length > 0 ? (
            <div className="homepage-suggestions" id="homepage-search-suggestions" role="listbox">
              {visibleSuggestions.map((suggestion) => (
                <button key={suggestion} type="button" role="option" onClick={() => submitSearch(suggestion)}>
                  <SearchIcon />
                  <span>{suggestion}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
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
  function BrowserWebView({ initialUrl, isActive, tabId, onLoadingChange, onNavigate, onSearch }, ref) {
    const webviewRef = useRef<WebViewDomElement | null>(null)
    // Electron treats a changed `src` attribute as a new navigation. Keep the
    // mount URL stable; subsequent navigation always goes through loadURL().
    const webviewInitialUrlRef = useRef(initialUrl)
    const [activeUrl, setActiveUrl] = useState(initialUrl)
    const [errorMessage, setErrorMessage] = useState('')
    const isElectronRuntime = Boolean(window.electronAPI)
    const isHomePage = activeUrl === HOMEPAGE_URL

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
          webviewRef.current.loadURL(url).catch((err: any) => {
            if (err && err.code !== 'ERR_ABORTED' && err.errno !== -3) {
              console.error('[webview] loadURL failed:', err)
            }
          })
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
      const handleStartLoading = () => onLoadingChange(tabId, true)
      const handleStopLoading = () => onLoadingChange(tabId, false)
      const handleNavigate = (event: Event) => {
        const nextUrl = (event as NavigationEvent).url
        if (nextUrl) {
          setActiveUrl(nextUrl)
          onNavigate(tabId, nextUrl)
        }
      }
      const handleFailure = (event: Event) => {
        const failure = event as NavigationEvent
        if (failure.errorCode === -3) {
          return
        }

        setErrorMessage(failure.errorDescription ?? 'Page failed to load')
        onLoadingChange(tabId, false)
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
    }, [isElectronRuntime, onLoadingChange, onNavigate, tabId])

    if (!isElectronRuntime) {
      return (
        <section className={`webview-stage ${isActive ? '' : 'webview-stage--inactive'}`} aria-hidden={!isActive} aria-label="Browser web view">
          <iframe className="browser-iframe" src={activeUrl} title="Browser preview" />
          {isHomePage ? <HomePage onSearch={(query) => onSearch(tabId, query)} /> : null}
          {!isHomePage ? <div className="webview-note">Electron webview activates inside desktop app.</div> : null}
        </section>
      )
    }

    return (
      <section className={`webview-stage ${isActive ? '' : 'webview-stage--inactive'}`} aria-hidden={!isActive} aria-label="Browser web view">
        <webview
          ref={setWebviewRef}
          className="browser-webview"
          src={webviewInitialUrlRef.current}
        />
        {isHomePage ? <HomePage onSearch={(query) => onSearch(tabId, query)} /> : null}
        {errorMessage ? <div className="webview-error" role="alert">{errorMessage}</div> : null}
      </section>
    )
  },
)
