import type { AnalysisDetails, RiskLevel, SecurityLabel } from './analysisDetailsTypes'

export type SecuritySource = 'direct_prompt' | 'webpage_content'

export type SecurityCheckResponse = {
  allowed: boolean
  label: SecurityLabel
  confidence: number
  risk_level: RiskLevel
  summary_reason: string
  matched_patterns: string[]
  source: SecuritySource
  timestamp: string
  analysis_details: AnalysisDetails
}

export type SecurityEvent = {
  allowed: boolean
  label: SecurityLabel
  source: SecuritySource
  summary_reason: string
  timestamp: string
}

export type HealthResponse = {
  status: string
  version: string
  model_loaded: boolean
}

export type LlmResponse = {
  response: string
  model: string
  usage: Record<string, number>
}

export type WebpageContent = {
  visible_text: string
  hidden_text: string
  html_comments: string
  meta_tags: string
  input_values: string
  page_title: string
  url: string
}
