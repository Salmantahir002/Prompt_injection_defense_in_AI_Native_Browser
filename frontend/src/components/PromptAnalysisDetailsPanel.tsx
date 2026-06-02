import type { AnalysisDetails } from '../types/analysisDetailsTypes'
import { ChunkAnalysisTable } from './ChunkAnalysisTable'
import { FeatureEvidenceList } from './FeatureEvidenceList'
import { ClassifierDecisionBreakdown } from './ClassifierDecisionBreakdown'

type PromptAnalysisDetailsPanelProps = {
  details: AnalysisDetails | null
  isOpen: boolean
  onClose: () => void
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 12 15 16 10" />
    </svg>
  )
}

function ShieldXIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  )
}

export function PromptAnalysisDetailsPanel({ details, isOpen, onClose }: PromptAnalysisDetailsPanelProps) {
  if (!details) return null

  const isSafe = !details.chunk_results.some((c) => c.label === 'malicious')
  const highestConfidence = Math.max(...details.chunk_results.map((c) => c.confidence))

  return (
    <>
      {/* Overlay */}
      <div
        className={`analysis-drawer-overlay ${isOpen ? 'analysis-drawer-overlay--open' : ''}`}
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className={`analysis-drawer ${isOpen ? 'analysis-drawer--open' : ''}`}>
        <div className="drawer-header">
          <h3>Detailed Analysis</h3>
          <button className="drawer-close-btn" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-content">
          {/* Decision Banner */}
          <div className={`drawer-decision ${isSafe ? 'drawer-decision--safe' : 'drawer-decision--blocked'}`}>
            <div className="drawer-decision-label">
              {isSafe ? <ShieldCheckIcon /> : <ShieldXIcon />}
              {isSafe ? 'Safe — Allowed' : 'Malicious — Blocked'}
            </div>
            <div className="drawer-decision-meta">
              <strong>{Math.round(highestConfidence * 100)}%</strong>
              confidence
            </div>
          </div>

          {/* Classifier Decision Breakdown */}
          <ClassifierDecisionBreakdown
            classifierMode={details.classifier_mode}
            thresholdUsed={details.threshold_used}
            finalRationale={details.final_rationale}
          />

          {/* Preprocessing Summary */}
          <div className="drawer-section">
            <div className="drawer-section-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
              Preprocessing Summary
            </div>
            <div className="drawer-section-body">
              <div className="detail-row">
                <span className="detail-label">Original Length</span>
                <span className="detail-value">{details.preprocessing.original_length} chars</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Normalized Length</span>
                <span className="detail-value">{details.preprocessing.normalized_length} chars</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Token Count</span>
                <span className="detail-value">{details.preprocessing.token_count}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Steps Applied</span>
                <span className="detail-value">{details.preprocessing.steps_applied.join(', ')}</span>
              </div>
            </div>
          </div>

          {/* Chunking Info */}
          <div className="drawer-section">
            <div className="drawer-section-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
              Chunking Analysis
            </div>
            <div className="drawer-section-body">
              <div className="detail-row">
                <span className="detail-label">Total Chunks</span>
                <span className="detail-value">{details.chunking.chunk_count}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Chunk Size</span>
                <span className="detail-value">{details.chunking.chunk_size}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Overlap</span>
                <span className="detail-value">{details.chunking.overlap}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Highest Risk Chunk</span>
                <span className="detail-value">{details.chunking.highest_risk_chunk_id}</span>
              </div>
            </div>
          </div>

          {/* Feature Evidence */}
          <FeatureEvidenceList evidence={details.feature_evidence} />

          {/* Per-Chunk Results */}
          <ChunkAnalysisTable chunks={details.chunk_results} />

          {/* Final Rationale */}
          <div className="drawer-section">
            <div className="drawer-section-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
              Final Rationale
            </div>
            <div className="drawer-section-body">
              <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
                {details.final_rationale}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
