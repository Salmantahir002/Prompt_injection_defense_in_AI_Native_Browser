import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { AiAssistantSidebar } from './components/AiAssistantSidebar'
import { BookmarkBar } from './components/BookmarkBar'
import { BrowserToolbar } from './components/BrowserToolbar'
import { BrowserWebView, type BrowserWebViewHandle } from './components/BrowserWebView'
import { BrowserLogo } from './components/BrowserLogo'
import { PromptAnalysisDetailsPanel } from './components/PromptAnalysisDetailsPanel'
import { WebpageAnalysisDetailsPanel } from './components/WebpageAnalysisDetailsPanel'
import { ProviderSettingsModal } from './components/ProviderSettingsModal'
import { LoadingProgressBar } from './components/LoadingProgressBar'
import { extractPageContent } from './services/pageContentExtractor'
import { checkWebpage } from './services/backendApiClient'
import type { AnalysisDetails } from './types/analysisDetailsTypes'
import type { BookmarkItem } from './types/bookmarkTypes'
import type { SecurityCheckResponse, WebpageContent } from './types/securityTypes'
import { extractDomainForFavicon, getFaviconCandidates, resolveNavigationUrl } from './services/urlUtils'
import sunSphereImage from './assets/sun-sphere.webp'
import './styles/layout.css'

const DEFAULT_BROWSER_URL = 'about:blank'
const HOMEPAGE_TAB_TITLE = 'New tab'

/** How long to wait for an agent-opened tab's webview to attach: 20 × 150ms. */
const AGENT_TAB_ATTACH_ATTEMPTS = 20
const AGENT_TAB_ATTACH_POLL_MS = 150
const MINIMUM_WEBPAGE_SCAN_DURATION_MS = 10_000

function waitForMinimumScanDuration(startedAt: number) {
  const remainingTime = MINIMUM_WEBPAGE_SCAN_DURATION_MS - (performance.now() - startedAt)
  return remainingTime > 0
    ? new Promise<void>((resolve) => window.setTimeout(resolve, remainingTime))
    : Promise.resolve()
}

type BrowserTab = {
  id: string
  title: string
  url: string
  favicon?: string
  isLoading?: boolean
}

function getTabTitle(url: string) {
  if (url === DEFAULT_BROWSER_URL) {
    return HOMEPAGE_TAB_TITLE
  }

  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

function SlideStartButton({ onStart }: { onStart: () => void }) {
  const containerRef = useRef<HTMLButtonElement>(null)
  const handleRef = useRef<HTMLSpanElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)

  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef(0)
  const maxOffsetRef = useRef(0)
  const dragOffsetRef = useRef(0)
  const dragAnimationFrameRef = useRef<number | null>(null)

  const updateDragVisual = useCallback((offset: number) => {
    dragOffsetRef.current = offset

    if (dragAnimationFrameRef.current !== null) return

    dragAnimationFrameRef.current = requestAnimationFrame(() => {
      dragAnimationFrameRef.current = null
      const currentOffset = dragOffsetRef.current
      const maxOffset = maxOffsetRef.current

      if (handleRef.current) {
        handleRef.current.style.transform = `translateX(${currentOffset}px)`
      }

      if (labelRef.current && maxOffset > 0) {
        labelRef.current.style.opacity = String(Math.max(0, 1 - currentOffset / (maxOffset * 0.7)))
      }
    })
  }, [])

  // Track global drag events to ensure smooth dragging outside the button boundaries
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current
      const newOffset = Math.max(0, Math.min(maxOffsetRef.current, deltaX))
      updateDragVisual(newOffset)

      if (newOffset >= maxOffsetRef.current * 0.95) {
        setIsDragging(false)
        setDragOffset(maxOffsetRef.current)
        onStart()
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return
      const deltaX = e.touches[0].clientX - startXRef.current
      const newOffset = Math.max(0, Math.min(maxOffsetRef.current, deltaX))
      updateDragVisual(newOffset)

      if (newOffset >= maxOffsetRef.current * 0.95) {
        setIsDragging(false)
        setDragOffset(maxOffsetRef.current)
        onStart()
      }
    }

    const handleDragEnd = () => {
      setIsDragging(false)
      setDragOffset(0)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleDragEnd)
    window.addEventListener('touchmove', handleTouchMove)
    window.addEventListener('touchend', handleDragEnd)

    return () => {
      if (dragAnimationFrameRef.current !== null) {
        cancelAnimationFrame(dragAnimationFrameRef.current)
        dragAnimationFrameRef.current = null
      }
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleDragEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleDragEnd)
    }
  }, [isDragging, onStart, updateDragVisual])

  const handleStartDrag = (clientX: number) => {
    if (!containerRef.current || !handleRef.current) return
    const containerRect = containerRef.current.getBoundingClientRect()
    const handleRect = handleRef.current.getBoundingClientRect()

    // 14px accounts for padding around the circle inside the button border
    maxOffsetRef.current = containerRect.width - handleRect.width - 14
    startXRef.current = clientX
    setIsDragging(true)
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return // Left click only
    handleStartDrag(e.clientX)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 0) return
    handleStartDrag(e.touches[0].clientX)
  }

  const handleButtonClick = () => {
    // If they just clicked without dragging, slide and trigger transition
    if (!isDragging && dragOffset === 0) {
      if (containerRef.current && handleRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect()
        const handleRect = handleRef.current.getBoundingClientRect()
        const target = containerRect.width - handleRect.width - 14
        setDragOffset(target)
      }
      setTimeout(() => {
        onStart()
      }, 250)
    }
  }

  const handleStyle: React.CSSProperties = {
    transform: `translateX(${dragOffset}px)`,
    transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  let textOpacity = 1
  if (maxOffsetRef.current > 0) {
    textOpacity = Math.max(0, 1 - dragOffset / (maxOffsetRef.current * 0.7))
  }

  return (
    <button
      ref={containerRef}
      className="start-button"
      type="button"
      onClick={handleButtonClick}
      style={{
        position: 'absolute',
        zIndex: 2,
        userSelect: 'none',
      }}
    >
      <span
        ref={handleRef}
        className="start-button__circle"
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        style={handleStyle}
        aria-hidden="true"
      >
        →
      </span>
      <span
        ref={labelRef}
        style={{
          opacity: textOpacity,
          transition: isDragging ? 'none' : 'opacity 0.2s ease',
          pointerEvents: 'none',
        }}
      >
        Get started
      </span>
    </button>
  )
}

function StartupScreen({
  onStart,
  isTransitioning,
}: {
  onStart: () => void
  isTransitioning: boolean
}) {
  const solarSystemRef = useRef<HTMLDivElement>(null)
  const [isGuideOpen, setIsGuideOpen] = useState(false)

  // Cancel the mouse-follow rAF before the transition frame paints. This keeps
  // it from competing with the solar-system burst as the swipe completes.
  useLayoutEffect(() => {
    if (isTransitioning) {
      if (solarSystemRef.current) {
        solarSystemRef.current.style.removeProperty('transform')
      }
      return
    }

    let active = true
    let mouseX = 0
    let mouseY = 0
    let currentX = 0
    let currentY = 0
    let rafId: number | null = null

    // Below this the movement is under a pixel and invisible, so the loop stops
    // rather than committing a new transform on every frame forever. An idle
    // welcome screen then costs the compositor nothing.
    const SETTLE_THRESHOLD_PX = 0.15

    const updatePosition = () => {
      if (!active) return
      rafId = null

      const deltaX = mouseX - currentX
      const deltaY = mouseY - currentY
      currentX += deltaX * 0.08
      currentY += deltaY * 0.08

      if (solarSystemRef.current) {
        solarSystemRef.current.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0)`
      }

      if (Math.abs(deltaX) > SETTLE_THRESHOLD_PX || Math.abs(deltaY) > SETTLE_THRESHOLD_PX) {
        rafId = requestAnimationFrame(updatePosition)
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      const targetX = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2)
      const targetY = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2)
      mouseX = targetX * 180 // Prominent 180px follow displacement
      mouseY = targetY * 180

      if (rafId === null) {
        rafId = requestAnimationFrame(updatePosition)
      }
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true })

    return () => {
      active = false
      window.removeEventListener('mousemove', handleMouseMove)
      if (rafId !== null) cancelAnimationFrame(rafId)
      if (solarSystemRef.current) {
        solarSystemRef.current.style.removeProperty('transform')
      }
    }
  }, [isTransitioning])

  return (
    <main className={`startup-screen ${isTransitioning ? 'startup-screen--transitioning' : ''}`}>
      <div className="grain-layer" />
      <div className="aurora-layer" />

      <header className="startup-header">
        <button
          className={`sound-button ${isGuideOpen ? 'sound-button--active' : ''}`}
          type="button"
          aria-controls="defense-guide"
          aria-expanded={isGuideOpen}
          aria-label="How Orbit works"
          onClick={() => setIsGuideOpen((isOpen) => !isOpen)}
        >
          <span aria-hidden="true">?</span>
        </button>
      </header>

      {isGuideOpen ? (
        <aside className="startup-guide" id="defense-guide" aria-label="How Orbit works">
          <h2>How Orbit works</h2>
          <p>Browse normally, then scan a page or ask the AI Agent to detect hidden instructions before they can influence your next action.</p>
        </aside>
      ) : null}

      <section className="welcome-stage" aria-labelledby="welcome-title">
        <h1 id="welcome-title" className="welcome-title">
          Welcome to Orbit
        </h1>
        <div className="orb-wrap" aria-hidden="true">
          <div className="defense-orb">
            <img
              src={sunSphereImage}
              alt=""
              className="defense-orb-img"
              draggable={false}
              decoding="sync"
              loading="eager"
            />
          </div>

          {/* Solar System Orbits */}
          <div className="solar-system" ref={solarSystemRef}>
            <div className="orbit orbit--1">
              <div className="planet planet--1" />
            </div>
            <div className="orbit orbit--2">
              <div className="planet planet--2" />
            </div>
            <div className="orbit orbit--3">
              <div className="planet planet--3" />
            </div>
          </div>
        </div>
        <SlideStartButton onStart={onStart} />
      </section>
    </main>
  )
}

/* The panel is a grid column, so its width has to stay wide enough to read and
   narrow enough to leave the page usable. */
const ASSISTANT_MIN_WIDTH = 320
const ASSISTANT_MAX_WIDTH = 760
const ASSISTANT_DEFAULT_WIDTH = 400
const ASSISTANT_WIDTH_STORAGE_KEY = 'promptguard.assistantWidth'

function clampAssistantWidth(width: number): number {
  // Never let the panel crowd the page out entirely on a small window.
  const upperBound = Math.max(
    ASSISTANT_MIN_WIDTH,
    Math.min(ASSISTANT_MAX_WIDTH, window.innerWidth - 420),
  )
  return Math.round(Math.min(Math.max(width, ASSISTANT_MIN_WIDTH), upperBound))
}

function readStoredAssistantWidth(): number {
  const stored = Number(window.localStorage.getItem(ASSISTANT_WIDTH_STORAGE_KEY))
  return Number.isFinite(stored) && stored > 0 ? clampAssistantWidth(stored) : ASSISTANT_DEFAULT_WIDTH
}

const BOOKMARKS_STORAGE_KEY = 'promptguard.bookmarks'

function readStoredBookmarks(): BookmarkItem[] {
  try {
    const stored = window.localStorage.getItem(BOOKMARKS_STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getFaviconUrl(url: string, explicitFavicon?: string): string | null {
  const candidates = getFaviconCandidates(url, explicitFavicon)
  return candidates.length > 0 ? candidates[0] : null
}

function AsteriskTabIcon() {
  return <BrowserLogo size={14} className="tab-asterisk-icon" />
}

function TabFaviconContent({ url, favicon }: { url: string; favicon?: string }) {
  const [candidateIndex, setCandidateIndex] = useState(0)
  const candidates = getFaviconCandidates(url, favicon)
  const activeSrc = candidates[candidateIndex]

  if (!activeSrc || candidateIndex >= candidates.length) {
    return <AsteriskTabIcon />
  }

  return (
    <img
      src={activeSrc}
      alt=""
      className="tab-favicon-img"
      onError={() => setCandidateIndex((prev) => prev + 1)}
    />
  )
}

function TabIcon({ url, favicon }: { url: string; favicon?: string }) {
  return <TabFaviconContent key={`${url}::${favicon || ''}`} url={url} favicon={favicon} />
}

function TabSpinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" className="tab-spinner" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="rgba(255, 255, 255, 0.18)" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="#8ab4f8" />
    </svg>
  )
}

function BrowserShell() {
  const webviewHandlesRef = useRef(new Map<string, BrowserWebViewHandle>())
  const loadingWatchdogsRef = useRef<Map<string, number>>(new Map())
  const nextTabId = useRef(2)
  const [tabs, setTabs] = useState<BrowserTab[]>([
    { id: 'tab-1', title: HOMEPAGE_TAB_TITLE, url: DEFAULT_BROWSER_URL, isLoading: false },
  ])
  const [activeTabId, setActiveTabId] = useState('tab-1')
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_BROWSER_URL)
  const [addressValue, setAddressValue] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantWidth, setAssistantWidth] = useState(readStoredAssistantWidth)
  const [isResizingAssistant, setIsResizingAssistant] = useState(false)

  // Prompt and webpage analyses deliberately keep independent state. A benign
  // prompt must never replace or be displayed as the result of a webpage scan.
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(false)
  const [promptDetails, setPromptDetails] = useState<AnalysisDetails | null>(null)
  const [webpageDrawerOpen, setWebpageDrawerOpen] = useState(false)
  const [webpageScanResult, setWebpageScanResult] = useState<SecurityCheckResponse | null>(null)
  const [webpageScanContent, setWebpageScanContent] = useState<WebpageContent | null>(null)
  const [isScanningPage, setIsScanningPage] = useState(false)
  const [isProviderSettingsOpen, setIsProviderSettingsOpen] = useState(false)
  const [activeTargetId, setActiveTargetId] = useState<number | null>(null)
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(readStoredBookmarks)

  useEffect(() => {
    try {
      window.localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks))
    } catch (err) {
      console.error('[bookmarks] failed to persist:', err)
    }
  }, [bookmarks])

  const handleAddBookmark = useCallback((title: string, url: string) => {
    const resolvedUrl = resolveNavigationUrl(url)
    setBookmarks((prev) => {
      if (prev.some((b) => b.url === resolvedUrl)) return prev
      return [
        ...prev,
        {
          id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title,
          url: resolvedUrl,
          favicon: getFaviconUrl(resolvedUrl) || undefined,
          createdAt: Date.now(),
        },
      ]
    })
  }, [])

  const handleEditBookmark = useCallback((id: string, title: string, url: string) => {
    const resolvedUrl = resolveNavigationUrl(url)
    setBookmarks((prev) => prev.map((b) => (
      b.id === id ? { ...b, title, url: resolvedUrl, favicon: getFaviconUrl(resolvedUrl) || b.favicon } : b
    )))
  }, [])

  const handleDeleteBookmark = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const handleToggleBookmarkCurrentPage = useCallback(() => {
    if (!currentUrl || currentUrl === DEFAULT_BROWSER_URL) return
    const activeTab = tabs.find((t) => t.id === activeTabId)
    const activeTitle = activeTab?.title || HOMEPAGE_TAB_TITLE
    const activeFavicon = activeTab?.favicon || getFaviconUrl(currentUrl) || undefined

    setBookmarks((prev) => {
      const existing = prev.find((b) => b.url === currentUrl)
      if (existing) {
        return prev.filter((b) => b.id !== existing.id)
      }
      return [
        ...prev,
        {
          id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: activeTitle,
          url: currentUrl,
          favicon: activeFavicon,
          createdAt: Date.now(),
        },
      ]
    })
  }, [activeTabId, currentUrl, tabs])

  const isCurrentUrlBookmarked = bookmarks.some(
    (b) => b.url === currentUrl && currentUrl !== DEFAULT_BROWSER_URL
  )

  const updateTabUrl = useCallback((tabId: string, url: string, title?: string, favicon?: string) => {
    setTabs((previousTabs) => previousTabs.map((tab) => {
      if (tab.id !== tabId) return tab
      const nextTitle = title || (url === DEFAULT_BROWSER_URL ? HOMEPAGE_TAB_TITLE : getTabTitle(url))
      const domain = extractDomainForFavicon(url)
      const domainFavicon = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : undefined
      const nextFavicon = favicon || (url === tab.url ? tab.favicon : domainFavicon) || domainFavicon
      return { ...tab, title: nextTitle, url, favicon: nextFavicon }
    }))
  }, [])

  const handleTabFaviconChange = useCallback((tabId: string, favicon: string) => {
    setTabs((previousTabs) => previousTabs.map((tab) => (
      tab.id === tabId ? { ...tab, favicon } : tab
    )))
  }, [])

  const handleTabTitleChange = useCallback((tabId: string, title: string) => {
    setTabs((previousTabs) => previousTabs.map((tab) => (
      tab.id === tabId ? { ...tab, title } : tab
    )))
  }, [])

  const handleWebViewLoadingChange = useCallback((tabId: string, loading: boolean) => {
    const existingTimer = loadingWatchdogsRef.current.get(tabId)
    if (existingTimer) {
      window.clearTimeout(existingTimer)
      loadingWatchdogsRef.current.delete(tabId)
    }

    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isLoading: loading } : t)))

    if (loading) {
      // Safety watchdog: ensure loading state never hangs permanently (e.g. background websockets/streaming)
      const timer = window.setTimeout(() => {
        loadingWatchdogsRef.current.delete(tabId)
        setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isLoading: false } : t)))
      }, 8000)
      loadingWatchdogsRef.current.set(tabId, timer)
    }
  }, [])

  const handleReload = useCallback(() => {
    handleWebViewLoadingChange(activeTabId, true)
    webviewHandlesRef.current.get(activeTabId)?.reload()
  }, [activeTabId, handleWebViewLoadingChange])

  const handleStop = useCallback(() => {
    webviewHandlesRef.current.get(activeTabId)?.stop()
    handleWebViewLoadingChange(activeTabId, false)
  }, [activeTabId, handleWebViewLoadingChange])

  const handleNavigate = useCallback((url: string) => {
    let resolved: string
    try {
      resolved = resolveNavigationUrl(url)
    } catch {
      resolved = url
    }
    const domain = extractDomainForFavicon(resolved)
    const initialFavicon = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : undefined

    setCurrentUrl(resolved)
    setAddressValue(resolved === DEFAULT_BROWSER_URL ? '' : resolved)
    updateTabUrl(activeTabId, resolved, undefined, initialFavicon)
    handleWebViewLoadingChange(activeTabId, true)
    webviewHandlesRef.current.get(activeTabId)?.loadURL(resolved)
  }, [activeTabId, handleWebViewLoadingChange, updateTabUrl])

  const handleWebViewNavigate = useCallback((tabId: string, url: string) => {
    const domain = extractDomainForFavicon(url)
    const initialFavicon = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : undefined
    updateTabUrl(tabId, url, undefined, initialFavicon)
    if (tabId === activeTabId) {
      setCurrentUrl(url)
      setAddressValue(url === DEFAULT_BROWSER_URL ? '' : url)
    }
  }, [activeTabId, updateTabUrl])

  const handleWebViewSearch = useCallback((tabId: string, query: string) => {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`
    updateTabUrl(tabId, url)
    if (tabId === activeTabId) {
      setCurrentUrl(url)
      setAddressValue(url)
    }
    webviewHandlesRef.current.get(tabId)?.loadURL(url)
  }, [activeTabId, updateTabUrl])

  const setWebviewHandle = useCallback((tabId: string, handle: BrowserWebViewHandle | null) => {
    if (handle) {
      webviewHandlesRef.current.set(tabId, handle)
    } else {
      webviewHandlesRef.current.delete(tabId)
    }
  }, [])

  const handleSelectTab = useCallback((tab: BrowserTab) => {
    setActiveTabId(tab.id)
    setCurrentUrl(tab.url)
    setAddressValue(tab.url === DEFAULT_BROWSER_URL ? '' : tab.url)
  }, [])

  const handleNewTab = useCallback(() => {
    const tab: BrowserTab = {
      id: `tab-${nextTabId.current++}`,
      title: HOMEPAGE_TAB_TITLE,
      url: DEFAULT_BROWSER_URL,
    }

    setTabs((previousTabs) => [...previousTabs, tab])
    handleSelectTab(tab)
  }, [handleSelectTab])

  const handleOpenBookmarkInNewTab = useCallback((url: string) => {
    let resolved: string
    try {
      resolved = resolveNavigationUrl(url)
    } catch {
      resolved = url
    }
    const domain = extractDomainForFavicon(resolved)
    const initialFavicon = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : undefined

    const tab: BrowserTab = {
      id: `tab-${nextTabId.current++}`,
      title: resolved === DEFAULT_BROWSER_URL ? HOMEPAGE_TAB_TITLE : getTabTitle(resolved),
      url: resolved,
      favicon: initialFavicon,
    }
    setTabs((previousTabs) => [...previousTabs, tab])
    handleSelectTab(tab)
  }, [handleSelectTab])

  /**
   * Opens a tab on the agent's behalf and resolves to its Browser Runtime
   * target id.
   *
   * The runtime addresses tabs by webContents id, which does not exist until
   * main resolves the createTab IPC call — so the id is polled rather than read straight
   * after the state update, the same way the assistant resolves the active
   * target. Resolving to null lets the agent replan instead of driving a tab
   * that never appeared.
   */
  const handleAgentOpenTab = useCallback(async (url?: string): Promise<number | null> => {
    const tabUrl = url ? resolveNavigationUrl(url) : DEFAULT_BROWSER_URL
    const domain = extractDomainForFavicon(tabUrl)
    const initialFavicon = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : undefined

    const tab: BrowserTab = {
      id: `tab-${nextTabId.current++}`,
      title: tabUrl === DEFAULT_BROWSER_URL ? HOMEPAGE_TAB_TITLE : getTabTitle(tabUrl),
      url: tabUrl,
      favicon: initialFavicon,
    }

    setTabs((previousTabs) => [...previousTabs, tab])
    handleSelectTab(tab)

    for (let attempt = 0; attempt < AGENT_TAB_ATTACH_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => { window.setTimeout(resolve, AGENT_TAB_ATTACH_POLL_MS) })

      const targetId = webviewHandlesRef.current.get(tab.id)?.getWebContentsId() ?? null
      if (targetId !== null) {
        setActiveTargetId(targetId)
        return targetId
      }
    }

    return null
  }, [handleSelectTab])

  const handleCloseTab = useCallback((tabId: string) => {
    const tabIndex = tabs.findIndex((tab) => tab.id === tabId)

    if (tabs.length === 1) {
      const replacementTab: BrowserTab = {
        id: `tab-${nextTabId.current++}`,
        title: HOMEPAGE_TAB_TITLE,
        url: DEFAULT_BROWSER_URL,
      }
      setTabs([replacementTab])
      handleSelectTab(replacementTab)
      return
    }

    const remainingTabs = tabs.filter((tab) => tab.id !== tabId)
    setTabs(remainingTabs)

    if (tabId === activeTabId) {
      handleSelectTab(remainingTabs[Math.max(0, tabIndex - 1)])
    }
  }, [activeTabId, handleSelectTab, tabs])

  const handleScanPage = useCallback(async () => {
    if (isScanningPage) return

    setIsScanningPage(true)
    const scanStartedAt = performance.now()
    try {
      const content = await extractPageContent(webviewHandlesRef.current.get(activeTabId) ?? null)
      if (!content) {
        return
      }

      setWebpageScanContent(content)
      setWebpageScanResult(null)
      setPromptDrawerOpen(false)
      setWebpageDrawerOpen(true)

      const result = await checkWebpage(content)
      await waitForMinimumScanDuration(scanStartedAt)
      setWebpageScanResult(result)

    } catch (error) {
      console.error('[ScanPage] Failed:', error)
      setWebpageDrawerOpen(false)
    } finally {
      setIsScanningPage(false)
    }
  }, [activeTabId, isScanningPage])

  // The webview attaches asynchronously, so the id is polled while the
  // assistant is open rather than read once at mount.
  useEffect(() => {
    if (!assistantOpen) return undefined

    const readTargetId = () => {
      const nextId = webviewHandlesRef.current.get(activeTabId)?.getWebContentsId() ?? null
      setActiveTargetId((current) => (current === nextId ? current : nextId))
    }

    readTargetId()
    const intervalId = window.setInterval(readTargetId, 1000)
    return () => window.clearInterval(intervalId)
  }, [activeTabId, assistantOpen, currentUrl])

  const handleViewPromptDetails = useCallback((details: AnalysisDetails) => {
    setPromptDetails(details)
    setWebpageDrawerOpen(false)
    setPromptDrawerOpen(true)
  }, [])

  const handleClosePromptDrawer = useCallback(() => {
    setPromptDrawerOpen(false)
  }, [])

  const handleCloseWebpageDrawer = useCallback(() => {
    setWebpageDrawerOpen(false)
  }, [])

  const handleAssistantWidthChange = useCallback((width: number) => {
    setAssistantWidth(clampAssistantWidth(width))
  }, [])

  // Persisted after the drag rather than during it, so one resize is one write.
  useEffect(() => {
    if (isResizingAssistant) return
    window.localStorage.setItem(ASSISTANT_WIDTH_STORAGE_KEY, String(assistantWidth))
  }, [assistantWidth, isResizingAssistant])

  // A shrinking window can leave a stored width wider than the shell allows.
  useEffect(() => {
    const handleResize = () => setAssistantWidth((current) => clampAssistantWidth(current))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Cleanup loading watchdog timers on unmount
  useEffect(() => {
    const watchdogs = loadingWatchdogsRef.current
    return () => {
      watchdogs.forEach((timer) => window.clearTimeout(timer))
      watchdogs.clear()
    }
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isCurrentTabLoading = Boolean(activeTab?.isLoading)

  return (
    <main className="browser-shell">
      {/* Tab Strip */}
      <div className="tab-strip" role="tablist" aria-label="Browser tabs">
        <div className="tab-strip-items">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              aria-selected={tab.id === activeTabId}
              className={`tab ${tab.id === activeTabId ? 'active-tab' : ''}`}
              onClick={() => handleSelectTab(tab)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  handleSelectTab(tab)
                }
              }}
              role="tab"
              tabIndex={tab.id === activeTabId ? 0 : -1}
            >
              {tab.isLoading ? (
                <TabSpinner />
              ) : (
                <TabIcon url={tab.url} favicon={tab.favicon} />
              )}
              <span className="tab-title">{tab.title}</span>
              <button
                className="tab-close-btn"
                type="button"
                aria-label={`Close ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  handleCloseTab(tab.id)
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="new-tab-btn" type="button" aria-label="New tab" onClick={handleNewTab}>+</button>
        </div>
        <div className="tab-strip-drag-region" aria-hidden="true" />
      </div>

      {/* Browser Frame */}
      <div className="browser-frame">
        <BrowserToolbar
          addressValue={addressValue}
          assistantOpen={assistantOpen}
          currentUrl={currentUrl}
          isLoading={isCurrentTabLoading}
          isScanning={isScanningPage}
          isBookmarked={isCurrentUrlBookmarked}
          onAddressChange={setAddressValue}
          onAssistantToggle={() => setAssistantOpen((isOpen) => !isOpen)}
          onBack={() => webviewHandlesRef.current.get(activeTabId)?.goBack()}
          onForward={() => webviewHandlesRef.current.get(activeTabId)?.goForward()}
          onNavigate={handleNavigate}
          onReload={handleReload}
          onStop={handleStop}
          onScanPage={handleScanPage}
          onToggleBookmark={handleToggleBookmarkCurrentPage}
        />
        <BookmarkBar
          bookmarks={bookmarks}
          currentUrl={currentUrl}
          currentTitle={activeTab?.title || HOMEPAGE_TAB_TITLE}
          onNavigate={handleNavigate}
          onOpenInNewTab={handleOpenBookmarkInNewTab}
          onAddBookmark={handleAddBookmark}
          onEditBookmark={handleEditBookmark}
          onDeleteBookmark={handleDeleteBookmark}
        />
        <LoadingProgressBar isLoading={isCurrentTabLoading} />
        <div
          className={`content-grid ${assistantOpen ? 'content-grid--assistant-open' : ''} ${isResizingAssistant ? 'content-grid--resizing' : ''}`}
          style={{ '--assistant-width': `${assistantWidth}px` } as CSSProperties}
        >
          <div className="webview-stack">
            {tabs.map((tab) => (
              <BrowserWebView
                key={tab.id}
                ref={(handle) => setWebviewHandle(tab.id, handle)}
                initialUrl={tab.url}
                isActive={tab.id === activeTabId}
                isObscured={promptDrawerOpen || webpageDrawerOpen || isProviderSettingsOpen || isResizingAssistant}
                tabId={tab.id}
                onLoadingChange={handleWebViewLoadingChange}
                onNavigate={handleWebViewNavigate}
                onFaviconChange={handleTabFaviconChange}
                onTitleChange={handleTabTitleChange}
                onSearch={handleWebViewSearch}
              />
            ))}
          </div>
          <div
            className={`assistant-sidebar-container ${assistantOpen ? 'assistant-sidebar-container--open' : 'assistant-sidebar-container--closed'}`}
            aria-hidden={!assistantOpen}
          >
            <AiAssistantSidebar
              activeTargetId={activeTargetId}
              activeTabTitle={tabs.find((tab) => tab.id === activeTabId)?.title}
              activeWebviewHandle={webviewHandlesRef.current.get(activeTabId) ?? null}
              currentUrl={currentUrl}
              onOpenTab={handleAgentOpenTab}
              onResizingChange={setIsResizingAssistant}
              onViewDetails={handleViewPromptDetails}
              onWidthChange={handleAssistantWidthChange}
              width={assistantWidth}
              onOpenSettings={() => setIsProviderSettingsOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* These are separate reports and retain their own result state. */}
      <PromptAnalysisDetailsPanel
        details={promptDetails}
        isOpen={promptDrawerOpen}
        onClose={handleClosePromptDrawer}
      />
      <WebpageAnalysisDetailsPanel
        content={webpageScanContent}
        isScanning={isScanningPage}
        result={webpageScanResult}
        isOpen={webpageDrawerOpen}
        onClose={handleCloseWebpageDrawer}
      />
      <ProviderSettingsModal
        isOpen={isProviderSettingsOpen}
        onClose={() => setIsProviderSettingsOpen(false)}
      />
    </main>
  )
}

function App() {
  const [transitionState, setTransitionState] = useState<'welcome' | 'animating' | 'blown'>('welcome')

  const handleStart = () => {
    setTransitionState('animating')
    setTimeout(() => {
      setTransitionState('blown')
    }, 2000)
  }

  if (transitionState === 'blown') {
    return (
      <div className="blown-shell-wrapper">
        <BrowserShell />
      </div>
    )
  }

  return (
    <StartupScreen
      onStart={handleStart}
      isTransitioning={transitionState === 'animating'}
    />
  )
}

export default App
