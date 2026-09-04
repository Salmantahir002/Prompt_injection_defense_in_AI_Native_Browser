import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from 'react'
import type { WebpageContent } from '../types/securityTypes'

export type BrowserWebViewHandle = {
  extractContent: () => Promise<WebpageContent | null>
  /** Browser Runtime target id for this tab; null before the webview attaches. */
  getWebContentsId: () => number | null
  getURL: () => string
  goBack: () => void
  goForward: () => void
  loadURL: (url: string) => void
  reload: () => void
}

type BrowserWebViewProps = {
  initialUrl: string
  isActive: boolean
  /** True while a drawer/modal must paint over this tab, or a drag (e.g. the assistant
   *  panel resize) must not have its pointer events swallowed by the guest content. */
  isObscured?: boolean
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

export const BrowserWebView = forwardRef<BrowserWebViewHandle, BrowserWebViewProps>(
  function BrowserWebView({ initialUrl, isActive, isObscured = false, tabId, onLoadingChange, onNavigate, onSearch }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const webContentsIdRef = useRef<number | null>(null)
    // The tab is created once, at mount, from this URL. Subsequent navigation
    // always goes through loadURL().
    const webviewInitialUrlRef = useRef(initialUrl)
    const [activeUrl, setActiveUrl] = useState(initialUrl)
    const [errorMessage, setErrorMessage] = useState('')
    const isElectronRuntime = Boolean(window.electronAPI)
    const isHomePage = activeUrl === HOMEPAGE_URL

    // The guest content is a native view main composites on top of this whole
    // window — nothing in our own DOM can paint over it with CSS. Whenever
    // something needs to show instead (the New Tab UI, a load error, a
    // drawer/modal, or an inactive tab), we hide the guest by shrinking it to
    // zero size rather than trying to layer on top of it.
    const shouldShowGuest = isActive && !isHomePage && !errorMessage && !isObscured
    const shouldShowGuestRef = useRef(shouldShowGuest)
    useEffect(() => {
      shouldShowGuestRef.current = shouldShowGuest
    }, [shouldShowGuest])

    const pushBounds = useCallback(() => {
      const webContentsId = webContentsIdRef.current
      const container = containerRef.current
      if (webContentsId === null || !container || !window.electronAPI) return

      if (!shouldShowGuestRef.current) {
        window.electronAPI.browser.setBounds(webContentsId, { x: 0, y: 0, width: 0, height: 0 })
        return
      }

      const rect = container.getBoundingClientRect()
      window.electronAPI.browser.setBounds(webContentsId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }, [])

    useImperativeHandle(ref, () => ({
      extractContent: async () => {
        const webContentsId = webContentsIdRef.current
        if (webContentsId === null) return null
        try {
          const result = await window.electronAPI?.scanWebview(webContentsId)
          return (result as WebpageContent) ?? null
        } catch {
          return null
        }
      },
      getWebContentsId: () => webContentsIdRef.current,
      getURL: () => activeUrl,
      goBack: () => {
        const webContentsId = webContentsIdRef.current
        if (webContentsId !== null) window.electronAPI?.browser.goBack(webContentsId)
      },
      goForward: () => {
        const webContentsId = webContentsIdRef.current
        if (webContentsId !== null) window.electronAPI?.browser.goForward(webContentsId)
      },
      loadURL: (url: string) => {
        setErrorMessage('')
        setActiveUrl(url)
        const webContentsId = webContentsIdRef.current
        if (webContentsId !== null) {
          window.electronAPI?.browser.navigate(webContentsId, url).catch((err: any) => {
            console.error('[browser] navigate failed:', err)
          })
        }
      },
      reload: () => {
        const webContentsId = webContentsIdRef.current
        if (webContentsId !== null) window.electronAPI?.browser.reload(webContentsId)
      },
    }), [activeUrl])

    // Creates this tab's guest view in main on mount, tears it down on unmount.
    // Runs once per component instance — a tab never changes which guest it owns.
    useEffect(() => {
      if (!isElectronRuntime) return undefined
      let cancelled = false

      window.electronAPI!.browser.createTab(webviewInitialUrlRef.current).then((result) => {
        if (cancelled || !result) return
        webContentsIdRef.current = result.webContentsId
        containerRef.current?.setAttribute('data-webcontents-id', String(result.webContentsId))
        pushBounds()
      })

      return () => {
        cancelled = true
        const webContentsId = webContentsIdRef.current
        if (webContentsId !== null) void window.electronAPI?.browser.closeTab(webContentsId)
      }
    }, [isElectronRuntime, pushBounds])

    // Keeps the guest's bounds in sync with this container's on-screen rect —
    // window resizes, the assistant panel opening, and active/obscured toggles
    // all reflow it.
    useEffect(() => {
      if (!isElectronRuntime) return undefined
      pushBounds()

      const container = containerRef.current
      if (!container) return undefined
      const observer = new ResizeObserver(pushBounds)
      observer.observe(container)
      return () => observer.disconnect()
    }, [isElectronRuntime, shouldShowGuest, pushBounds])

    useEffect(() => {
      if (!isElectronRuntime) return undefined

      return window.electronAPI!.browser.onTabEvent((event) => {
        if (event.webContentsId !== webContentsIdRef.current) return

        switch (event.type) {
          case 'did-start-loading':
            onLoadingChange(tabId, true)
            break
          case 'did-stop-loading':
            onLoadingChange(tabId, false)
            break
          case 'did-navigate':
          case 'did-navigate-in-page':
            if (event.url) {
              setActiveUrl(event.url)
              onNavigate(tabId, event.url)
            }
            break
          case 'did-fail-load':
            if (event.errorCode === -3) break // aborted by a subsequent navigation
            setErrorMessage(event.errorDescription ?? 'Page failed to load')
            onLoadingChange(tabId, false)
            break
        }
      })
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
        {/* Empty on purpose: the actual page is a WebContentsView main composites
            over this rect (see pushBounds above), not a child of this DOM tree. */}
        <div ref={containerRef} className="browser-webview" />
        {isHomePage ? <HomePage onSearch={(query) => onSearch(tabId, query)} /> : null}
        {errorMessage ? <div className="webview-error" role="alert">{errorMessage}</div> : null}
      </section>
    )
  },
)
