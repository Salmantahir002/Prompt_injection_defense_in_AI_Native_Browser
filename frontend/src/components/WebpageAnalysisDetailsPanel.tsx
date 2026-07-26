import type { ChunkResult } from '../types/analysisDetailsTypes'
import type { SecurityCheckResponse, WebpageContent } from '../types/securityTypes'

type Props = {
  content: WebpageContent | null
  isOpen: boolean
  result: SecurityCheckResponse | null
  onClose: () => void
}

function ShieldIcon({ blocked = false }: { blocked?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      {blocked ? <><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></> : <polyline points="9 12 12 15 16 10" />}
    </svg>
  )
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function SourceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="webpage-scan-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SuspiciousChunk({ chunk }: { chunk: ChunkResult }) {
  return (
    <article className="webpage-scan-chunk">
      <div className="webpage-scan-chunk__header">
        <span>{chunk.chunk_id}</span>
        <strong>{Math.round(chunk.confidence * 100)}%</strong>
      </div>
      <p>{chunk.reason}</p>
      {chunk.matched_patterns.length > 0 ? (
        <div className="feature-tags">
          {chunk.matched_patterns.map((pattern) => <span className="feature-tag feature-tag--danger" key={pattern}>{pattern}</span>)}
        </div>
      ) : null}
    </article>
  )
}

export function WebpageAnalysisDetailsPanel({ content, isOpen, result, onClose }: Props) {
  if (!content || !result) return null

  const details = result.analysis_details
  const suspiciousChunks = details.chunk_results.filter((chunk) => chunk.label === 'malicious')
  const isBlocked = !result.allowed

  return (
    <>
      <div className={`analysis-drawer-overlay ${isOpen ? 'analysis-drawer-overlay--open' : ''}`} onClick={onClose} />
      <section className={`analysis-drawer webpage-analysis-drawer ${isOpen ? 'analysis-drawer--open' : ''}`} aria-label="Webpage scan report" aria-modal="true" role="dialog">
        <header className="drawer-header">
          <div>
            <h3>Webpage Scan Report</h3>
            <p className="webpage-scan-subtitle">Indirect prompt-injection analysis</p>
          </div>
          <button className="drawer-close-btn" type="button" onClick={onClose} aria-label="Close webpage scan report">✕</button>
        </header>

        <div className="drawer-content">
          <div className={`drawer-decision ${isBlocked ? 'drawer-decision--blocked' : 'drawer-decision--safe'}`}>
            <div className="drawer-decision-label">
              <ShieldIcon blocked={isBlocked} />
              <div>
                <div>{isBlocked ? 'Page threat detected' : 'No page injection detected'}</div>
                <div className="webpage-decision-copy">{result.summary_reason}</div>
              </div>
            </div>
            <div className="drawer-decision-meta"><strong>{Math.round(result.confidence * 100)}%</strong>confidence</div>
          </div>

          <div className={`webpage-credential-notice ${isBlocked ? 'webpage-credential-notice--blocked' : ''}`}>
            <WarningIcon />
            <div>
              <strong>{isBlocked ? 'Do not interact with this page.' : 'A passed scan is not credential clearance.'}</strong>
              <p>{isBlocked
                ? 'Do not enter passwords, payment details, or other sensitive information while this page is flagged.'
                : 'This scan checks page content for indirect prompt injection. It does not verify that a site, login form, or payment request is legitimate.'}</p>
            </div>
          </div>

          <section className="drawer-section">
            <div className="drawer-section-header"><ScanIcon /> Scanned webpage</div>
            <div className="drawer-section-body webpage-scan-page">
              <span className="webpage-scan-page__label">Page title</span>
              <strong>{content.page_title || 'Untitled page'}</strong>
              <span className="webpage-scan-page__label">URL scanned</span>
              <code>{content.url}</code>
            </div>
          </section>

          <section className="drawer-section">
            <div className="drawer-section-header"><ScanIcon /> Scan coverage</div>
            <div className="drawer-section-body webpage-scan-stats">
              <SourceStat label="Visible page text" value={`${content.visible_text.length.toLocaleString()} chars`} />
              <SourceStat label="Hidden content" value={`${content.hidden_text.length.toLocaleString()} chars`} />
              <SourceStat label="HTML comments" value={`${content.html_comments.length.toLocaleString()} chars`} />
              <SourceStat label="Metadata" value={`${content.meta_tags.length.toLocaleString()} chars`} />
              <SourceStat label="Content chunks" value={String(details.chunking.chunk_count)} />
              <SourceStat label="Classifier" value={details.classifier_mode === 'ml_model' ? 'ML model' : 'Rule based'} />
            </div>
          </section>

          <section className="drawer-section">
            <div className="drawer-section-header"><WarningIcon /> Page threat signals</div>
            <div className="drawer-section-body">
              {result.matched_patterns.length > 0 ? (
                <div className="feature-tags">
                  {result.matched_patterns.map((pattern) => <span className="feature-tag feature-tag--danger" key={pattern}>{pattern}</span>)}
                </div>
              ) : <p className="webpage-scan-empty">No indirect prompt-injection patterns were found in the scanned page content.</p>}
              {suspiciousChunks.length > 0 ? (
                <div className="webpage-scan-chunks">
                  {suspiciousChunks.map((chunk) => <SuspiciousChunk chunk={chunk} key={chunk.chunk_id} />)}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </>
  )
}
