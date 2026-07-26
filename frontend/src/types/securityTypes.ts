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
  aria_text: string
  iframe_content: string
  shadow_dom_content: string
  external_javascript: string
  inline_javascript: string
  css_content: string
  css_generated_content: string
  network_responses: string
  websocket_messages: string
  service_worker_activity: string
  source_maps: string
  redirects: string
  third_party_resources: string
  suspicious_domains: string
  frame_navigation: string
  runtime_script_activity: string
  loaded_resources: string
  dom_snapshot_content: string
}
