import type { AnalysisDetails, ChunkResult } from '../types/analysisDetailsTypes'

type Props = {
  details: AnalysisDetails | null
  isOpen: boolean
  onClose: () => void
}

// ── Icons ────────────────────────────────────────────────────────────────────

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 12 15 16 10" />
    </svg>
  )
}

function ShieldXIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  )
}

function CpuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  )
}

function AlertTriangleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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

// ── Sub-components ────────────────────────────────────────────────────────────

function ThreatMeter({ value, label }: { value: number; label: string }) {
  const pct = Math.min(Math.round(value * 100), 100)
  const color =
    pct > 70
      ? 'linear-gradient(90deg, #dc2626, #f87171)'
      : pct > 40
      ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
      : 'linear-gradient(90deg, #059669, #34d399)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ minWidth: 170, fontSize: 12, color: 'rgba(255,255,255,0.52)', fontWeight: 500 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: 99,
            transition: 'width 0.6s cubic-bezier(0.22,1,0.36,1)',
          }}
        />
      </div>
      <span style={{ minWidth: 36, textAlign: 'right', fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.85)' }}>
        {pct}%
      </span>
    </div>
  )
}

function CountBadge({ count, label, danger = false }: { count: number; label: string; danger?: boolean }) {
  const isAlert = danger && count > 0
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '14px 8px',
        borderRadius: 10,
        background: isAlert ? 'rgba(248,113,113,0.07)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isAlert ? 'rgba(248,113,113,0.20)' : 'rgba(255,255,255,0.07)'}`,
      }}
    >
      <span
        style={{
          fontSize: 22,
          fontWeight: 800,
          fontFamily: "'JetBrains Mono', monospace",
          color: isAlert ? '#f87171' : 'rgba(255,255,255,0.85)',
          lineHeight: 1,
        }}
      >
        {count}
      </span>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.38)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          textAlign: 'center',
          lineHeight: 1.3,
        }}
      >
        {label}
      </span>
    </div>
  )
}

function ChunkRow({ chunk }: { chunk: ChunkResult }) {
  const isMalicious = chunk.label === 'malicious'
  const pct = Math.round(chunk.confidence * 100)
  const riskColor =
    chunk.risk_level === 'high'
      ? { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.18)', text: '#f87171' }
      : chunk.risk_level === 'medium'
      ? { bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.15)', text: '#fbbf24' }
      : { bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.15)', text: '#34d399' }

  return (
    <div
      style={{
        padding: '11px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: isMalicious ? 'rgba(248,113,113,0.025)' : 'transparent',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: 'rgba(251,191,36,0.65)',
            minWidth: 58,
          }}
        >
          {chunk.chunk_id}
        </span>
        <span className={`chunk-label ${isMalicious ? 'chunk-label--malicious' : 'chunk-label--safe'}`}>
          {chunk.label}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 5,
            background: riskColor.bg,
            border: `1px solid ${riskColor.border}`,
            color: riskColor.text,
            textTransform: 'capitalize',
          }}
        >
          {chunk.risk_level} risk
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 700,
            color: isMalicious ? '#f87171' : '#34d399',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {pct}%
        </span>
      </div>

      {/* Only show reason + patterns for malicious chunks — keeps it concise */}
      {isMalicious && (
        <div style={{ marginTop: 8, paddingLeft: 66 }}>
          {chunk.reason && (
            <p style={{ margin: '0 0 6px', fontSize: 11.5, color: 'rgba(255,255,255,0.58)', lineHeight: 1.6 }}>
              {chunk.reason}
            </p>
          )}
          {chunk.matched_patterns.length > 0 && (
            <div className="feature-tags">
              {chunk.matched_patterns.map((p) => (
                <span key={p} className="feature-tag feature-tag--danger">
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function PromptAnalysisDetailsPanel({ details, isOpen, onClose }: Props) {
  if (!details) return null

  const maliciousChunks = details.chunk_results.filter((c) => c.label === 'malicious')
  const safeChunks = details.chunk_results.filter((c) => c.label !== 'malicious')
  const isSafe = maliciousChunks.length === 0
  const highestConfidence = Math.max(...details.chunk_results.map((c) => c.confidence))
  const isMLModel = details.classifier_mode === 'ml_model'
  const fe = details.feature_evidence

  return (
    <>
      {/* Overlay */}
      <div
        className={`analysis-drawer-overlay ${isOpen ? 'analysis-drawer-overlay--open' : ''}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div className={`analysis-drawer ${isOpen ? 'analysis-drawer--open' : ''}`}>
        <div className="drawer-header">
          <h3>Detailed Analysis</h3>
          <button className="drawer-close-btn" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-content">

          {/* ── 1. VERDICT BANNER ─────────────────────────────────────── */}
          <div className={`drawer-decision ${isSafe ? 'drawer-decision--safe' : 'drawer-decision--blocked'}`}>
            <div className="drawer-decision-label">
              {isSafe ? <ShieldCheckIcon /> : <ShieldXIcon />}
              <div>
                <div>{isSafe ? 'Safe — Allowed' : 'Malicious — Blocked'}</div>
                <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.6, marginTop: 2 }}>
                  {isSafe
                    ? `All ${details.chunk_results.length} chunks passed the safety threshold`
                    : `${maliciousChunks.length} of ${details.chunk_results.length} chunks flagged`}
                </div>
              </div>
            </div>
            <div className="drawer-decision-meta">
              <strong>{Math.round(highestConfidence * 100)}%</strong>
              confidence
            </div>
          </div>

          {/* ── 2. CLASSIFIER DECISION ────────────────────────────────── */}
          <div className="drawer-section">
            <div className="drawer-section-header">
              <CpuIcon />
              Classifier Decision
            </div>
            <div className="drawer-section-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Mode card + threshold badge */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div
                  style={{
                    flex: 1,
                    padding: '11px 14px',
                    borderRadius: 9,
                    background: isMLModel ? 'rgba(52,211,153,0.06)' : 'rgba(251,191,36,0.06)',
                    border: `1px solid ${isMLModel ? 'rgba(52,211,153,0.18)' : 'rgba(251,191,36,0.18)'}`,
                  }}
                >
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Mode
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isMLModel ? '#34d399' : '#fbbf24' }}>
                    {isMLModel ? '🤖  ML Model' : '📏  Rule-Based Fallback'}
                  </div>
                </div>
                <div
                  style={{
                    padding: '11px 14px',
                    borderRadius: 9,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    textAlign: 'center',
                    minWidth: 82,
                  }}
                >
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Threshold
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.88)' }}>
                    {(details.threshold_used * 100).toFixed(0)}%
                  </div>
                </div>
              </div>

              {/* Decision rationale */}
              <div
                style={{
                  padding: '11px 14px',
                  borderRadius: 9,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(251,191,36,0.50)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Decision Rationale
                </div>
                <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,0.68)', lineHeight: 1.7 }}>
                  {details.final_rationale}
                </p>
              </div>
            </div>
          </div>

          {/* ── 3. THREAT SIGNALS ─────────────────────────────────────── */}
          <div className="drawer-section">
            <div className="drawer-section-header">
              <AlertTriangleIcon />
              Threat Signals Detected
            </div>
            <div className="drawer-section-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Count badges */}
              <div style={{ display: 'flex', gap: 8 }}>
                <CountBadge count={fe.role_override_count} label="Role Override Attempts" danger />
                <CountBadge count={fe.data_exfiltration_count} label="Data Exfiltration Signals" danger />
                <CountBadge count={maliciousChunks.length} label="Malicious Chunks" danger />
              </div>

              {/* Metric bars */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <ThreatMeter value={fe.instruction_density} label="Instruction Density" />
                <ThreatMeter value={fe.semantic_similarity_to_malicious_patterns} label="Similarity to Known Attacks" />
              </div>

              {/* Top suspicious terms */}
              {fe.top_terms.length > 0 && (
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(251,191,36,0.50)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Top Suspicious Terms
                  </div>
                  <div className="feature-tags">
                    {fe.top_terms.map((term) => (
                      <span key={term} className="feature-tag">
                        {term}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Vectorizer note */}
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.28)', fontFamily: "'JetBrains Mono', monospace" }}>
                Vectorizer: {fe.embedding_or_vectorizer_used}
              </div>
            </div>
          </div>

          {/* ── 4. CHUNK SCAN RESULTS ─────────────────────────────────── */}
          <div className="drawer-section">
            <div className="drawer-section-header">
              <ScanIcon />
              Chunk Scan Results
              <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.38)', fontSize: 10, marginLeft: 4 }}>
                ({details.chunk_results.length} chunks · size {details.chunking.chunk_size} · overlap {details.chunking.overlap})
              </span>
            </div>
            <div className="drawer-section-body" style={{ padding: 0 }}>
              {/* Safe / Flagged summary */}
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ flex: 1, padding: '10px 14px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: '#34d399' }}>
                    {safeChunks.length}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Safe
                  </div>
                </div>
                <div style={{ flex: 1, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: maliciousChunks.length > 0 ? '#f87171' : 'rgba(255,255,255,0.28)' }}>
                    {maliciousChunks.length}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Flagged
                  </div>
                </div>
              </div>

              {/* Chunk rows — malicious first */}
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {maliciousChunks.map((chunk) => (
                  <ChunkRow key={chunk.chunk_id} chunk={chunk} />
                ))}
                {safeChunks.map((chunk) => (
                  <ChunkRow key={chunk.chunk_id} chunk={chunk} />
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
