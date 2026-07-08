import type { FeatureEvidence } from '../types/analysisDetailsTypes'

type FeatureEvidenceListProps = {
  evidence: FeatureEvidence
}

export function FeatureEvidenceList({ evidence }: FeatureEvidenceListProps) {
  return (
    <div className="drawer-section">
      <div className="drawer-section-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
        Feature Extraction Evidence
      </div>
      <div className="drawer-section-body">
        <div className="detail-row">
          <span className="detail-label">Instruction Density</span>
          <span className="detail-value">{(evidence.instruction_density * 100).toFixed(1)}%</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Role Override Count</span>
          <span className="detail-value" style={{ color: evidence.role_override_count > 0 ? '#f87171' : undefined }}>
            {evidence.role_override_count}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Data Exfiltration Count</span>
          <span className="detail-value" style={{ color: evidence.data_exfiltration_count > 0 ? '#f87171' : undefined }}>
            {evidence.data_exfiltration_count}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Semantic Similarity</span>
          <span className="detail-value">
            {(evidence.semantic_similarity_to_malicious_patterns * 100).toFixed(1)}%
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Vectorizer / Embedding</span>
          <span className="detail-value">{evidence.embedding_or_vectorizer_used}</span>
        </div>

        {evidence.top_terms.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <div style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: 'rgba(251, 191, 36, 0.50)',
              marginBottom: 10,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.06em',
            }}>
              Top Suspicious Terms
            </div>
            <div className="feature-tags">
              {evidence.top_terms.map((term) => (
                <span key={term} className="feature-tag">{term}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
