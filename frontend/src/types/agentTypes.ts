import type { PageStateSnapshot, RuntimeCommandName } from './browserRuntimeTypes'

/** Tool names the planner may emit. Mirrors backend `agent_tool_registry.py`. */
export type AgentToolName =
  | 'click'
  | 'fill'
  | 'type'
  | 'press_key'
  | 'navigate'
  | 'scroll'
  | 'upload'
  | 'wait'
  | 'extract'
  | 'finish'

export type AgentToolCall = {
  tool: AgentToolName
  arguments: Record<string, unknown>
  requires_approval?: boolean
}

export type AgentPlanResponse = {
  /** The queued actions. `tool_call` is the first, kept for single-step callers. */
  tool_calls: AgentToolCall[]
  tool_call: AgentToolCall
  confidence: number
  /** True when confidence fell below the backend threshold — pause for the user. */
  needs_user_confirmation: boolean
  reason: string
  model: string
  planner_mode: 'llm'
}

export type AgentStepRecord = {
  tool: string
  summary: string
  succeeded: boolean
}

export type AgentFailureRecord = {
  tool: string
  reason: string
  code?: string
}

/**
 * The planner's entire recollection — a bounded, structured summary rather
 * than a conversation transcript.
 */
export type AgentWorkingMemorySnapshot = {
  goal: string
  completed_steps: AgentStepRecord[]
  pending_steps: string[]
  failures: AgentFailureRecord[]
  retries: number
  current_page: string
}

export type AgentPlanRequest = {
  goal: string
  working_memory: AgentWorkingMemorySnapshot
  page_state: PageStateSnapshot
}

/**
 * A tool call resolved to a concrete Browser Runtime command. `null` means the
 * tool is handled by the agent loop itself rather than by the browser.
 */
export type ResolvedToolCommand = {
  command: RuntimeCommandName
  params: Record<string, unknown>
} | null

export type AgentThreatFinding = {
  source: string
  confidence: number
  matched_patterns: string[]
  matched_evidence: string[]
  excerpt: string
}

/** Verdict from POST /api/v1/agent/scan-active-page. */
export type AgentScanDecision = {
  allowed: boolean
  task_id: string
  url: string
  page_hash: string
  risk_level: 'low' | 'medium' | 'high'
  confidence: number
  summary_reason: string
  matched_patterns: string[]
  blocked_sources: string[]
  findings: AgentThreatFinding[]
  scanned_chunks: number
  classifier_mode: string
  scanned_at: string
  /** Set locally when a cached verdict was reused instead of rescanning. */
  fromCache?: boolean
}

export type AgentAbortReason =
  | 'injection_detected'
  | 'scan_failed'
  | 'planner_failed'
  | 'action_failed'
  | 'needs_confirmation'
  | 'declined'
  | 'step_limit'
  | 'cancelled'

export type AgentTaskStatus = 'idle' | 'running' | 'completed' | 'blocked' | 'failed'

export type AgentIterationOutcome = {
  status: 'continue' | 'finished' | 'aborted'
  reason?: AgentAbortReason
  message: string
  toolCall?: AgentToolCall
  decision?: AgentScanDecision | null
}

export type AgentTaskResult = {
  taskId: string
  status: AgentTaskStatus
  message: string
  steps: number
  reason?: AgentAbortReason
  decision?: AgentScanDecision | null
}
