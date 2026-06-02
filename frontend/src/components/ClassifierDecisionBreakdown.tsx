import type { ClassifierMode } from '../types/analysisDetailsTypes'

type ClassifierDecisionBreakdownProps = {
  classifierMode: ClassifierMode
  thresholdUsed: number
  finalRationale: string
}

export function ClassifierDecisionBreakdown({
  classifierMode,
  thresholdUsed,
  finalRationale,
}: ClassifierDecisionBreakdownProps) {
  const isMLModel = classifierMode === 'ml_model'
  const modeLabel = isMLModel ? 'ML Model' : 'Rule-Based Fallback'

  return (
    <div className="drawer-section">
      <div className="drawer-section-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        Classifier Decision
      </div>
      <div className="drawer-section-body">
        <div className="detail-row">
          <span className="detail-label">Classifier Mode</span>
          <span className="detail-value" style={{ color: isMLModel ? '#34d399' : '#fbbf24' }}>
            {modeLabel}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Threshold</span>
          <span className="detail-value">{(thresholdUsed * 100).toFixed(0)}%</span>
        </div>

        {/* Threshold visual bar */}
        <div style={{ marginTop: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
            Decision Threshold
          </div>
          <div style={{ position: 'relative', width: '100%', height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${thresholdUsed * 100}%`,
              background: 'linear-gradient(90deg, #34d399, #fbbf24)',
              borderRadius: 99,
            }} />
            <div style={{
              position: 'absolute',
              left: `${thresholdUsed * 100}%`,
              top: -4,
              width: 2,
              height: 16,
              background: '#fff',
              borderRadius: 1,
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
            <span>Safe</span>
            <span>Malicious</span>
          </div>
        </div>

        <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
            Rationale
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
            {finalRationale}
          </p>
        </div>
      </div>
    </div>
  )
}
