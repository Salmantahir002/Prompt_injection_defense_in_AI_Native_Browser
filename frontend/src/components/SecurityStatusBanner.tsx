import type { SecurityCheckResponse } from '../types/securityTypes'

type SecurityStatusBannerProps = {
  result: SecurityCheckResponse
}

export function SecurityStatusBanner({ result }: SecurityStatusBannerProps) {
  const isBlocked = !result.allowed
  const confidencePercent = Math.round(result.confidence * 100)

  return (
    <section className={`security-banner ${isBlocked ? 'security-banner--blocked' : 'security-banner--safe'}`}>
      <div className="security-banner__topline">
        <span className="security-badge">{isBlocked ? 'Blocked' : 'Safe'}</span>
        <span>{confidencePercent}%</span>
      </div>
      <strong>{result.risk_level} risk</strong>
      <p>{result.summary_reason}</p>
      <button className="analysis-button" type="button">View Detailed Analysis</button>
    </section>
  )
}
