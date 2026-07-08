import type { ChunkResult } from '../types/analysisDetailsTypes'

type ChunkAnalysisTableProps = {
  chunks: ChunkResult[]
}

export function ChunkAnalysisTable({ chunks }: ChunkAnalysisTableProps) {
  return (
    <div className="drawer-section">
      <div className="drawer-section-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v18H3z" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
        Per-Chunk Results ({chunks.length})
      </div>
      <div className="drawer-section-body" style={{ padding: 0 }}>
        <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'hidden' }}>
          <table className="chunk-table">
            <thead>
              <tr>
                <th>Chunk</th>
                <th>Label</th>
                <th>Confidence</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {chunks.map((chunk) => (
                <tr key={chunk.chunk_id}>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: 'rgba(251, 191, 36, 0.65)' }}>
                    {chunk.chunk_id}
                  </td>
                  <td>
                    <span className={`chunk-label ${chunk.label === 'malicious' ? 'chunk-label--malicious' : 'chunk-label--safe'}`}>
                      {chunk.label}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600, fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                      {Math.round(chunk.confidence * 100)}%
                    </span>
                    <div className="confidence-meter">
                      <div
                        className={`confidence-meter-fill ${chunk.label === 'malicious' ? 'confidence-meter-fill--danger' : 'confidence-meter-fill--safe'}`}
                        style={{ width: `${Math.round(chunk.confidence * 100)}%` }}
                      />
                    </div>
                  </td>
                  <td style={{
                    textTransform: 'capitalize',
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: chunk.risk_level === 'Low'
                      ? 'rgba(52, 211, 153, 0.75)'
                      : chunk.risk_level === 'High'
                        ? '#f87171'
                        : 'rgba(251, 191, 36, 0.75)',
                  }}>
                    {chunk.risk_level}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Chunk details expanded */}
        {chunks.map((chunk) => (
          <div
            key={`detail-${chunk.chunk_id}`}
            style={{
              padding: '14px 18px',
              borderTop: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'rgba(251, 191, 36, 0.50)',
              marginBottom: 6,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
            }}>
              {chunk.chunk_id} — Reason
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,0.62)', lineHeight: 1.6 }}>
              {chunk.reason}
            </p>
            {chunk.matched_patterns.length > 0 ? (
              <div className="feature-tags" style={{ marginTop: 10 }}>
                {chunk.matched_patterns.map((pattern) => (
                  <span key={pattern} className="feature-tag feature-tag--danger">{pattern}</span>
                ))}
              </div>
            ) : null}
            <div style={{
              marginTop: 10,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.015)',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.04)',
              fontSize: 11,
              color: 'rgba(255,255,255,0.40)',
              fontFamily: "'JetBrains Mono', monospace",
              wordBreak: 'break-all',
              lineHeight: 1.5,
            }}>
              {chunk.excerpt}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
