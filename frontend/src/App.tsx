import { useCallback, useEffect, useRef, useState } from 'react'
import { AiAssistantSidebar } from './components/AiAssistantSidebar'
import { BrowserToolbar } from './components/BrowserToolbar'
import { BrowserWebView, type BrowserWebViewHandle } from './components/BrowserWebView'
import { PromptAnalysisDetailsPanel } from './components/PromptAnalysisDetailsPanel'
import { extractPageContent } from './services/pageContentExtractor'
import { checkWebpage } from './services/backendApiClient'
import type { AnalysisDetails } from './types/analysisDetailsTypes'
import type { SecurityEvent } from './types/securityTypes'
import './styles/layout.css'

const DEFAULT_BROWSER_URL = 'https://www.google.com'

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="Prompt Defense">
      <span className="brand-mark__rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>prompt defense</span>
    </div>
  )
}

function SlideStartButton({ onStart }: { onStart: () => void }) {
  const containerRef = useRef<HTMLButtonElement>(null)
  const handleRef = useRef<HTMLSpanElement>(null)

  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef(0)
  const maxOffsetRef = useRef(0)

  // Track global drag events to ensure smooth dragging outside the button boundaries
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current
      const newOffset = Math.max(0, Math.min(maxOffsetRef.current, deltaX))
      setDragOffset(newOffset)

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
      setDragOffset(newOffset)

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
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleDragEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleDragEnd)
    }
  }, [isDragging, onStart])

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

  useEffect(() => {
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
    let rafId: number

    const handleMouseMove = (e: MouseEvent) => {
      const targetX = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2)
      const targetY = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2)
      mouseX = targetX * 180 // Prominent 180px follow displacement
      mouseY = targetY * 180
    }

    const updatePosition = () => {
      if (!active) return

      currentX += (mouseX - currentX) * 0.08
      currentY += (mouseY - currentY) * 0.08

      if (solarSystemRef.current) {
        solarSystemRef.current.style.transform = `scale(1) translate3d(${currentX}px, ${currentY}px, 0)`
      }

      rafId = requestAnimationFrame(updatePosition)
    }

    window.addEventListener('mousemove', handleMouseMove)
    rafId = requestAnimationFrame(updatePosition)

    return () => {
      active = false
      window.removeEventListener('mousemove', handleMouseMove)
      cancelAnimationFrame(rafId)
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
        <BrandMark />
        <button className="sound-button" type="button" aria-label="Toggle sound">
          <span aria-hidden="true">))</span>
        </button>
      </header>

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

function BrowserShell() {
  const webviewRef = useRef<BrowserWebViewHandle | null>(null)
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_BROWSER_URL)
  const [addressValue, setAddressValue] = useState(DEFAULT_BROWSER_URL)
  const [isLoading, setIsLoading] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)

  // Analysis drawer state (Phase 4)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeDetails, setActiveDetails] = useState<AnalysisDetails | null>(null)

  // Toast notifications state
  const [toasts, setToasts] = useState<(SecurityEvent & { id: string })[]>([])

  const addToast = useCallback((event: SecurityEvent) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { ...event, id }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4500)
  }, [])

  const handleNavigate = useCallback((url: string) => {
    setCurrentUrl(url)
    setAddressValue(url)
    webviewRef.current?.loadURL(url)
  }, [])

  const handleWebViewNavigate = useCallback((url: string) => {
    setCurrentUrl(url)
    setAddressValue(url)
  }, [])

  const handleScanPage = useCallback(async () => {
    const content = await extractPageContent(webviewRef.current)
    if (!content) {
      return
    }

    try {
      const result = await checkWebpage(content)
      // Show result in the analysis drawer
      setActiveDetails(result.analysis_details)
      setDrawerOpen(true)

      // Add a security toast
      addToast({
        allowed: result.allowed,
        label: result.label,
        source: result.source,
        summary_reason: result.summary_reason,
        timestamp: result.timestamp,
      })
    } catch (error) {
      console.error('[ScanPage] Failed:', error)
    }
  }, [addToast])

  const handleViewDetails = useCallback((details: AnalysisDetails) => {
    setActiveDetails(details)
    setDrawerOpen(true)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
  }, [])

  return (
    <main className="browser-shell">
      {/* Tab Strip */}
      <div className="tab-strip">
        <div className="tab active-tab">
          <span className="tab-dot" />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Prompt Defense
          </span>
          <button className="tab-close-btn" type="button" aria-label="Close tab">✕</button>
        </div>
        <button className="new-tab-btn" type="button" aria-label="New tab">+</button>
      </div>

      {/* Browser Frame */}
      <div className="browser-frame">
        <BrowserToolbar
          addressValue={addressValue}
          assistantOpen={assistantOpen}
          currentUrl={currentUrl}
          isLoading={isLoading}
          onAddressChange={setAddressValue}
          onAssistantToggle={() => setAssistantOpen((isOpen) => !isOpen)}
          onBack={() => webviewRef.current?.goBack()}
          onForward={() => webviewRef.current?.goForward()}
          onNavigate={handleNavigate}
          onReload={() => webviewRef.current?.reload()}
          onScanPage={handleScanPage}
        />
        <div className={`content-grid ${assistantOpen ? 'content-grid--assistant-open' : ''}`}>
          <BrowserWebView
            ref={webviewRef}
            initialUrl={DEFAULT_BROWSER_URL}
            onLoadingChange={setIsLoading}
            onNavigate={handleWebViewNavigate}
          />
          {assistantOpen ? (
            <AiAssistantSidebar onViewDetails={handleViewDetails} onSecurityEvent={addToast} />
          ) : null}
        </div>
      </div>

      {/* Toast Notifications System */}
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-notification ${
              toast.allowed ? 'toast-notification--safe' : 'toast-notification--blocked'
            }`}
          >
            <div className="toast-header">
              <span className="toast-title">
                {toast.allowed ? '🛡️ Safe Check' : '🚨 Blocked'}
              </span>
              <time className="toast-time">
                {(() => {
                  try {
                    const date = new Date(toast.timestamp)
                    return isNaN(date.getTime())
                      ? new Date().toLocaleTimeString()
                      : date.toLocaleTimeString()
                  } catch {
                    return new Date().toLocaleTimeString()
                  }
                })()}
              </time>
            </div>
            <p className="toast-body">{toast.summary_reason}</p>
          </div>
        ))}
      </div>

      {/* Analysis Details Drawer (Phase 4) */}
      <PromptAnalysisDetailsPanel
        details={activeDetails}
        isOpen={drawerOpen}
        onClose={handleCloseDrawer}
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
