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
                <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                  {chunk.chunk_id}
                </td>
                <td>
                  <span className={`chunk-label ${chunk.label === 'malicious' ? 'chunk-label--malicious' : 'chunk-label--safe'}`}>
                    {chunk.label}
                  </span>
                </td>
                <td>
                  <span style={{ fontWeight: 600 }}>{Math.round(chunk.confidence * 100)}%</span>
                  <div className="confidence-meter">
                    <div
                      className={`confidence-meter-fill ${chunk.label === 'malicious' ? 'confidence-meter-fill--danger' : 'confidence-meter-fill--safe'}`}
                      style={{ width: `${Math.round(chunk.confidence * 100)}%` }}
                    />
                  </div>
                </td>
                <td style={{ textTransform: 'capitalize', fontSize: 11, fontWeight: 600 }}>
                  {chunk.risk_level}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Chunk details expanded */}
        {chunks.map((chunk) => (
          <div key={`detail-${chunk.chunk_id}`} style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>
              {chunk.chunk_id} — Reason
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
              {chunk.reason}
            </p>
            {chunk.matched_patterns.length > 0 ? (
              <div className="feature-tags" style={{ marginTop: 8 }}>
                {chunk.matched_patterns.map((pattern) => (
                  <span key={pattern} className="feature-tag feature-tag--danger">{pattern}</span>
                ))}
              </div>
            ) : null}
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}>
              {chunk.excerpt}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
