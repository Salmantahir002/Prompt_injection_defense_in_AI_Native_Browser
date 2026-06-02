import { useState, type FormEvent } from 'react'
import { normalizeUrl } from '../services/urlUtils'

type BrowserToolbarProps = {
  addressValue: string
  assistantOpen: boolean
  currentUrl: string
  isLoading: boolean
  onAddressChange: (value: string) => void
  onAssistantToggle: () => void
  onBack: () => void
  onForward: () => void
  onNavigate: (url: string) => void
  onReload: () => void
  onScanPage: () => void
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function ReloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
    </svg>
  )
}

export function BrowserToolbar({
  addressValue,
  assistantOpen,
  isLoading,
  onAddressChange,
  onAssistantToggle,
  onBack,
  onForward,
  onNavigate,
  onReload,
  onScanPage,
}: BrowserToolbarProps) {
  const [errorMessage, setErrorMessage] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      const normalizedUrl = normalizeUrl(addressValue)
      setErrorMessage('')
      onNavigate(normalizedUrl)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Enter a valid URL')
    }
  }

  return (
    <div className="toolbar-row" aria-label="Browser toolbar">
      <nav className="toolbar-actions" style={{ marginRight: 4 }}>
        <button className="nav-btn" type="button" onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <button className="nav-btn" type="button" onClick={onForward} aria-label="Forward">
          <ForwardIcon />
        </button>
        <button className="nav-btn" type="button" onClick={onReload} aria-label={isLoading ? 'Stop' : 'Reload'}>
          {isLoading ? <StopIcon /> : <ReloadIcon />}
        </button>
      </nav>

      <form className="address-form" onSubmit={handleSubmit}>
        <span className="lock-icon"><LockIcon /></span>
        <input
          aria-label="URL"
          className="address-input"
          spellCheck={false}
          placeholder="Search or enter URL"
          value={addressValue}
          onChange={(event) => onAddressChange(event.target.value)}
        />
        <button className="go-button" type="submit">Go</button>
      </form>

      <div className="toolbar-actions">
        <button className="scan-button" type="button" onClick={onScanPage}>
          <ShieldIcon />
          Scan
        </button>
        <button
          className={`assistant-pill ${assistantOpen ? 'assistant-pill--active' : ''}`}
          type="button"
          aria-pressed={assistantOpen}
          onClick={onAssistantToggle}
        >
          <SparklesIcon />
          Assistant
        </button>
      </div>

      {errorMessage ? <div className="toolbar-error" role="alert">{errorMessage}</div> : null}
    </div>
  )
}
