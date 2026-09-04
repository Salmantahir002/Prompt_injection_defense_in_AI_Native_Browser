import { Type, type Static } from '@sinclair/typebox'
import { AnalysisDetailsSchema } from './analysisDetails.schemas.js'

export const PromptCheckRequestSchema = Type.Object({
  prompt: Type.String(),
})

// Field-for-field port of WebpageCheckRequest. Required fields intentionally
// match Pydantic's defaults: only the original seven core capture fields are
// required, while the newer channels default to an empty string.
export const WebpageCheckRequestSchema = Type.Object({
  visible_text: Type.String(),
  hidden_text: Type.String(),
  html_comments: Type.String(),
  meta_tags: Type.String(),
  input_values: Type.String(),
  page_title: Type.String(),
  url: Type.String(),
  aria_text: Type.Optional(Type.String()),
  iframe_content: Type.Optional(Type.String()),
  shadow_dom_content: Type.Optional(Type.String()),
  external_javascript: Type.Optional(Type.String()),
  inline_javascript: Type.Optional(Type.String()),
  css_content: Type.Optional(Type.String()),
  css_generated_content: Type.Optional(Type.String()),
  network_responses: Type.Optional(Type.String()),
  websocket_messages: Type.Optional(Type.String()),
  service_worker_activity: Type.Optional(Type.String()),
  source_maps: Type.Optional(Type.String()),
  redirects: Type.Optional(Type.String()),
  third_party_resources: Type.Optional(Type.String()),
  suspicious_domains: Type.Optional(Type.String()),
  frame_navigation: Type.Optional(Type.String()),
  runtime_script_activity: Type.Optional(Type.String()),
  loaded_resources: Type.Optional(Type.String()),
  dom_snapshot_content: Type.Optional(Type.String()),
})

export const SecurityCheckResponseSchema = Type.Object({
  allowed: Type.Boolean(),
  label: Type.Union([Type.Literal('benign'), Type.Literal('malicious')]),
  confidence: Type.Number(),
  risk_level: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
  summary_reason: Type.String(),
  matched_patterns: Type.Array(Type.String()),
  source: Type.Union([Type.Literal('direct_prompt'), Type.Literal('webpage_content')]),
  timestamp: Type.String(),
  analysis_details: AnalysisDetailsSchema,
})

export type PromptCheckRequest = Static<typeof PromptCheckRequestSchema>
export type WebpageCheckRequest = Static<typeof WebpageCheckRequestSchema>
export type SecurityCheckResponse = Static<typeof SecurityCheckResponseSchema>
