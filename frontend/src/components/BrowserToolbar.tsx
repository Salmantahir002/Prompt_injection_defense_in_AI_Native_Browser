import { useState, type FormEvent } from 'react'
import { extractDomain, normalizeUrl } from '../services/urlUtils'

type BrowserToolbarProps = {
  addressValue: string
  currentUrl: string
  isLoading: boolean
  onAddressChange: (value: string) => void
  onBack: () => void
  onForward: () => void
  onNavigate: (url: string) => void
  onReload: () => void
  onScanPage: () => void
}

export function BrowserToolbar({
  addressValue,
  currentUrl,
  isLoading,
  onAddressChange,
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
    <div className="toolbar-row browser-toolbar" aria-label="Browser toolbar">
      <button className="chrome-icon-button" type="button" onClick={onBack} aria-label="Back">
        &lt;
      </button>
      <button className="chrome-icon-button" type="button" onClick={onForward} aria-label="Forward">
        &gt;
      </button>
      <button className="chrome-icon-button" type="button" onClick={onReload} aria-label="Reload">
        {isLoading ? 'x' : 'o'}
      </button>
      <form className="address-form" onSubmit={handleSubmit}>
        <span className="address-domain">{extractDomain(currentUrl)}</span>
        <input
          aria-label="URL"
          className="address-input"
          spellCheck={false}
          value={addressValue}
          onChange={(event) => onAddressChange(event.target.value)}
        />
        <button className="go-button" type="submit">Go</button>
      </form>
      <button className="scan-button" type="button" onClick={onScanPage}>Scan Page</button>
      <button className="assistant-pill" type="button">Assistant</button>
      {errorMessage ? <div className="toolbar-error" role="alert">{errorMessage}</div> : null}
    </div>
  )
}
