// Port of backend/app/schemas/agent_schemas.py.
// Deliberately separate from security.schemas.ts, even though field names
// overlap: the manual-scan contract and the agent contract must be able to
// change independently — that isolation is the whole point.
//
// Phase 3 ported the /agent/scan-active-page + /agent/security/events +
// /agent/tools slice below. Phase 4 adds AgentPlanRequest/AgentPlanResponse
// and the working-memory/page-state schemas the LLM-backed planner consumes.
import { Type, type Static } from '@sinclair/typebox'

// Every field defaults to "" in the Python model — all optional here too.
export const AgentPageSnapshotSchema = Type.Object({
  visible_text: Type.Optional(Type.String()),
  hidden_text: Type.Optional(Type.String()),
  html_comments: Type.Optional(Type.String()),
  meta_tags: Type.Optional(Type.String()),
  input_values: Type.Optional(Type.String()),
  aria_text: Type.Optional(Type.String()),
  iframe_content: Type.Optional(Type.String()),
  shadow_dom_content: Type.Optional(Type.String()),
  inline_javascript: Type.Optional(Type.String()),
  external_javascript: Type.Optional(Type.String()),
  css_content: Type.Optional(Type.String()),
  css_generated_content: Type.Optional(Type.String()),
  network_responses: Type.Optional(Type.String()),
  websocket_messages: Type.Optional(Type.String()),
  service_worker_activity: Type.Optional(Type.String()),
  dom_snapshot_content: Type.Optional(Type.String()),
  page_title: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  // Node-only extended channels (Phase 2) — see security.routes.ts. Accepted
  // here too since the same CDP capture is reused for both scan paths.
  source_maps: Type.Optional(Type.String()),
  redirects: Type.Optional(Type.String()),
  third_party_resources: Type.Optional(Type.String()),
  suspicious_domains: Type.Optional(Type.String()),
  frame_navigation: Type.Optional(Type.String()),
  runtime_script_activity: Type.Optional(Type.String()),
  loaded_resources: Type.Optional(Type.String()),
})

export const AgentScanRequestSchema = Type.Object({
  task_id: Type.String(),
  url: Type.Optional(Type.String()),
  page_hash: Type.Optional(Type.String()),
  snapshot: AgentPageSnapshotSchema,
})

export const AgentThreatFindingSchema = Type.Object({
  source: Type.String(),
  confidence: Type.Number(),
  matched_patterns: Type.Array(Type.String()),
  matched_evidence: Type.Array(Type.String()),
  excerpt: Type.String(),
})

export const AgentScanResponseSchema = Type.Object({
  allowed: Type.Boolean(),
  task_id: Type.String(),
  url: Type.String(),
  page_hash: Type.String(),
  risk_level: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
  confidence: Type.Number(),
  summary_reason: Type.String(),
  matched_patterns: Type.Array(Type.String()),
  blocked_sources: Type.Array(Type.String()),
  findings: Type.Array(AgentThreatFindingSchema),
  scanned_chunks: Type.Integer(),
  classifier_mode: Type.String(),
  scanned_at: Type.String(),
})

export type AgentPageSnapshot = Static<typeof AgentPageSnapshotSchema>
export type AgentScanRequest = Static<typeof AgentScanRequestSchema>
export type AgentScanResponse = Static<typeof AgentScanResponseSchema>

// ─────────────────────────── Phase 4: planner contract ───────────────────────────
// One actionable element, as produced by the frontend State Builder.
export const AgentSemanticElementSchema = Type.Object({
  id: Type.String(),
  role: Type.String(),
  name: Type.Optional(Type.String()),
  value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  disabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  required: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  focused: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  expanded: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  selected: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  checked: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  invalid: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  nearbyText: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  placeholder: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  container: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  inputType: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  nameAttr: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

export const AgentSemanticDialogSchema = Type.Object({
  id: Type.String(),
  role: Type.String(),
  name: Type.Optional(Type.String()),
  modal: Type.Optional(Type.Boolean()),
})

export const AgentValidationIssueSchema = Type.Object({
  elementId: Type.String(),
  role: Type.String(),
  message: Type.Optional(Type.String()),
})

// The compact semantic state. The raw accessibility tree never arrives here.
export const AgentPageStateSchema = Type.Object({
  url: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  elements: Type.Optional(Type.Array(AgentSemanticElementSchema)),
  focusedElementId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  dialogs: Type.Optional(Type.Array(AgentSemanticDialogSchema)),
  validationErrors: Type.Optional(Type.Array(AgentValidationIssueSchema)),
  selectedElementIds: Type.Optional(Type.Array(Type.String())),
  truncated: Type.Optional(Type.Boolean()),
})

export const AgentStepRecordSchema = Type.Object({
  tool: Type.String(),
  summary: Type.Optional(Type.String()),
  succeeded: Type.Optional(Type.Boolean()),
})

export const AgentFailureRecordSchema = Type.Object({
  tool: Type.String(),
  reason: Type.Optional(Type.String()),
  code: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

// The planner's entire recollection. Deliberately not a conversation
// transcript: a bounded, structured summary keeps the prompt small and stops
// older page content from accumulating in context.
export const AgentWorkingMemorySchema = Type.Object({
  goal: Type.Optional(Type.String()),
  completed_steps: Type.Optional(Type.Array(AgentStepRecordSchema)),
  pending_steps: Type.Optional(Type.Array(Type.String())),
  failures: Type.Optional(Type.Array(AgentFailureRecordSchema)),
  retries: Type.Optional(Type.Integer()),
  current_page: Type.Optional(Type.String()),
})

export const AgentPlanRequestSchema = Type.Object({
  goal: Type.String(),
  working_memory: Type.Optional(AgentWorkingMemorySchema),
  page_state: Type.Optional(AgentPageStateSchema),
})

// A single validated action. `arguments` is already schema-checked.
export const AgentToolCallSchema = Type.Object({
  tool: Type.String(),
  arguments: Type.Record(Type.String(), Type.Unknown()),
  requires_approval: Type.Boolean(),
})

export const AgentPlanResponseSchema = Type.Object({
  tool_calls: Type.Array(AgentToolCallSchema, { minItems: 1 }),
  tool_call: AgentToolCallSchema,
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  needs_user_confirmation: Type.Boolean(),
  reason: Type.String(),
  model: Type.String(),
  planner_mode: Type.Literal('llm'),
})

export type AgentSemanticElement = Static<typeof AgentSemanticElementSchema>
export type AgentSemanticDialog = Static<typeof AgentSemanticDialogSchema>
export type AgentValidationIssue = Static<typeof AgentValidationIssueSchema>
export type AgentPageState = Static<typeof AgentPageStateSchema>
export type AgentStepRecord = Static<typeof AgentStepRecordSchema>
export type AgentFailureRecord = Static<typeof AgentFailureRecordSchema>
export type AgentWorkingMemory = Static<typeof AgentWorkingMemorySchema>
export type AgentPlanRequest = Static<typeof AgentPlanRequestSchema>
export type AgentToolCall = Static<typeof AgentToolCallSchema>
export type AgentPlanResponse = Static<typeof AgentPlanResponseSchema>
