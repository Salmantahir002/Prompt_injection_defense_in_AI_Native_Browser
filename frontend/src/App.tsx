import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { AiAssistantSidebar } from './components/AiAssistantSidebar'
import { BrowserToolbar } from './components/BrowserToolbar'
import { BrowserWebView, type BrowserWebViewHandle } from './components/BrowserWebView'
import { PromptAnalysisDetailsPanel } from './components/PromptAnalysisDetailsPanel'
import { WebpageAnalysisDetailsPanel } from './components/WebpageAnalysisDetailsPanel'
import { extractPageContent } from './services/pageContentExtractor'
import { checkWebpage } from './services/backendApiClient'
import type { AnalysisDetails } from './types/analysisDetailsTypes'
import type { SecurityCheckResponse, WebpageContent } from './types/securityTypes'
import './styles/layout.css'

const DEFAULT_BROWSER_URL = 'about:blank'
const HOMEPAGE_TAB_TITLE = 'New Tab'

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
          aria-label="How Prompt Defense works"
          onClick={() => setIsGuideOpen((isOpen) => !isOpen)}
        >
          <span aria-hidden="true">?</span>
        </button>
      </header>

      {isGuideOpen ? (
        <aside className="startup-guide" id="defense-guide" aria-label="How Prompt Defense works">
          <h2>How your defense works</h2>
          <p>Browse normally, then scan a page or ask the Assistant to detect hidden instructions before they can influence your next action.</p>
        </aside>
      ) : null}

      <section className="welcome-stage" aria-labelledby="welcome-title">
        <h1 id="welcome-title" className="welcome-title">
          Welcome to Prompt Defense
        </h1>
        <div className="orb-wrap" aria-hidden="true">
          <div className="defense-orb">
            <span className="orb-shade orb-shade--top" />
            <span className="orb-shade orb-shade--belt" />
            <span className="orb-shade orb-shade--glow" />
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

      <p className="terms-copy">
        By continuing, you agree to the Terms of Service and Privacy Policy
      </p>
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

function BrowserShell() {
  const webviewHandlesRef = useRef(new Map<string, BrowserWebViewHandle>())
  const nextTabId = useRef(2)
  const [tabs, setTabs] = useState<BrowserTab[]>([
    { id: 'tab-1', title: HOMEPAGE_TAB_TITLE, url: DEFAULT_BROWSER_URL },
  ])
  const [activeTabId, setActiveTabId] = useState('tab-1')
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_BROWSER_URL)
  const [addressValue, setAddressValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
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
  // Resolved lazily: the webview only has a webContents id once it attaches.
  const [activeTargetId, setActiveTargetId] = useState<number | null>(null)

  const updateTabUrl = useCallback((tabId: string, url: string) => {
    setTabs((previousTabs) => previousTabs.map((tab) => (
      tab.id === tabId ? { ...tab, title: getTabTitle(url), url } : tab
    )))
  }, [])

  const handleNavigate = useCallback((url: string) => {
    setCurrentUrl(url)
    setAddressValue(url)
    updateTabUrl(activeTabId, url)
    webviewHandlesRef.current.get(activeTabId)?.loadURL(url)
  }, [activeTabId, updateTabUrl])

  const handleWebViewNavigate = useCallback((tabId: string, url: string) => {
    updateTabUrl(tabId, url)
    if (tabId === activeTabId) {
      setCurrentUrl(url)
      setAddressValue(url === DEFAULT_BROWSER_URL ? '' : url)
    }
  }, [activeTabId, updateTabUrl])

  const handleWebViewLoadingChange = useCallback((tabId: string, loading: boolean) => {
    if (tabId === activeTabId) {
      setIsLoading(loading)
    }
  }, [activeTabId])

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
    setIsLoading(false)
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

  /**
   * Opens a tab on the agent's behalf and resolves to its Browser Runtime
   * target id.
   *
   * The runtime addresses tabs by webContents id, which does not exist until
   * the <webview> has attached — so the id is polled rather than read straight
   * after the state update, the same way the assistant resolves the active
   * target. Resolving to null lets the agent replan instead of driving a tab
   * that never appeared.
   */
  const handleAgentOpenTab = useCallback(async (url?: string): Promise<number | null> => {
    const tabUrl = url ?? DEFAULT_BROWSER_URL
    const tab: BrowserTab = {
      id: `tab-${nextTabId.current++}`,
      title: tabUrl === DEFAULT_BROWSER_URL ? HOMEPAGE_TAB_TITLE : getTabTitle(tabUrl),
      url: tabUrl,
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

  return (
    <main className="browser-shell">
      {/* Tab Strip */}
      <div className="tab-strip" role="tablist" aria-label="Browser tabs">
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
            <span className="tab-dot" />
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

      {/* Browser Frame */}
      <div className="browser-frame">
        <BrowserToolbar
          addressValue={addressValue}
          assistantOpen={assistantOpen}
          currentUrl={currentUrl}
          isLoading={isLoading}
          isScanning={isScanningPage}
          onAddressChange={setAddressValue}
          onAssistantToggle={() => setAssistantOpen((isOpen) => !isOpen)}
          onBack={() => webviewHandlesRef.current.get(activeTabId)?.goBack()}
          onForward={() => webviewHandlesRef.current.get(activeTabId)?.goForward()}
          onNavigate={handleNavigate}
          onReload={() => webviewHandlesRef.current.get(activeTabId)?.reload()}
          onScanPage={handleScanPage}
        />
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
                tabId={tab.id}
                onLoadingChange={handleWebViewLoadingChange}
                onNavigate={handleWebViewNavigate}
                onSearch={handleWebViewSearch}
              />
            ))}
          </div>
          {assistantOpen ? (
            <AiAssistantSidebar
              activeTargetId={activeTargetId}
              currentUrl={currentUrl}
              onOpenTab={handleAgentOpenTab}
              onResizingChange={setIsResizingAssistant}
              onViewDetails={handleViewPromptDetails}
              onWidthChange={handleAssistantWidthChange}
              width={assistantWidth}
            />
          ) : null}
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
