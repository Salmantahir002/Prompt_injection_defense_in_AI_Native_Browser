import { useCallback, useRef, useState } from 'react'
import { BrowserToolbar } from './components/BrowserToolbar'
import { BrowserWebView, type BrowserWebViewHandle } from './components/BrowserWebView'
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

function StartupScreen({ onStart }: { onStart: () => void }) {
  return (
    <main className="startup-screen">
      <div className="grain-layer" />
      <div className="aurora-layer" />

      <header className="startup-header">
        <BrandMark />
        <button className="sound-button" type="button" aria-label="Toggle sound">
          <span aria-hidden="true">))</span>
        </button>
      </header>

      <section className="welcome-stage" aria-labelledby="welcome-title">
        <h1 id="welcome-title">Welcome to Prompt Defense</h1>
        <div className="orb-wrap" aria-hidden="true">
          <div className="defense-orb">
            <span className="orb-shade orb-shade--top" />
            <span className="orb-shade orb-shade--belt" />
            <span className="orb-shade orb-shade--glow" />
          </div>
        </div>
        <button className="start-button" type="button" onClick={onStart}>
          <span className="start-button__circle" aria-hidden="true">-&gt;</span>
          <span>Get started</span>
        </button>
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
  const [scanMessage, setScanMessage] = useState('Page scanning arrives in Frontend Phase 4')

  const handleNavigate = useCallback((url: string) => {
    setScanMessage('Page scanning arrives in Frontend Phase 4')
    setCurrentUrl(url)
    setAddressValue(url)
    webviewRef.current?.loadURL(url)
  }, [])

  const handleWebViewNavigate = useCallback((url: string) => {
    setCurrentUrl(url)
    setAddressValue(url)
  }, [])

  const handleScanPage = useCallback(() => {
    setScanMessage('Scan Page control is wired; extraction backend arrives in later phases')
  }, [])

  return (
    <main className="browser-shell">
      <div className="tab-strip">
        <div className="tab active-tab">
          <span className="tab-dot" />
          Prompt Defense
        </div>
        <button className="chrome-icon-button" type="button" aria-label="New tab">+</button>
      </div>
      <div className="browser-frame">
        <BrowserToolbar
          addressValue={addressValue}
          currentUrl={currentUrl}
          isLoading={isLoading}
          onAddressChange={setAddressValue}
          onBack={() => webviewRef.current?.goBack()}
          onForward={() => webviewRef.current?.goForward()}
          onNavigate={handleNavigate}
          onReload={() => webviewRef.current?.reload()}
          onScanPage={handleScanPage}
        />
        <div className="content-grid">
          <BrowserWebView
            ref={webviewRef}
            initialUrl={DEFAULT_BROWSER_URL}
            onLoadingChange={setIsLoading}
            onNavigate={handleWebViewNavigate}
          />
          <aside className="assistant-panel" aria-label="Assistant panel">
            <div className="assistant-logo" />
            <h2>Assistant</h2>
            <p className="assistant-copy">{scanMessage}</p>
            <div className="assistant-input">Ask anything...</div>
          </aside>
        </div>
      </div>
    </main>
  )
}

function App() {
  const [started, setStarted] = useState(false)

  if (started) {
    return <BrowserShell />
  }

  return <StartupScreen onStart={() => setStarted(true)} />
}

export default App
