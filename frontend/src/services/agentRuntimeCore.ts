import type {
  AgentAbortReason,
  AgentPlanResponse,
  AgentScanDecision,
  AgentTaskResult,
  AgentToolCall,
} from '../types/agentTypes'
import type { PageStateSnapshot } from '../types/browserRuntimeTypes'
import { AgentCircuitBreaker, type CircuitBreakerState } from './agentCircuitBreaker'
import { approvalFor, type ApprovalHandler } from './agentApprovalPolicy'
import { AgentWorkingMemory } from './agentWorkingMemory'
import { AgentPlanError, requestPlan } from './agentApiClient'
import { AgentSecurityPipeline, AgentSecurityScanError } from './agentSecurityPipeline'
import { extractPageState, invokeRuntime, isBrowserRuntimeAvailable, setAgentOverlay } from './browserRuntime'
import { isTerminalTool, resolveToolCall } from './agentToolRegistry'

/**
 * The agent loop.
 *
 * Runs entirely in the renderer: every browser action goes out over
 * `invokeRuntime` to the CDP-native Browser Runtime (native input, verified
 * before/after), every plan comes from the backend planner, and every page is
 * scanned for injection before any queued action from that plan executes.
 * There is no main-process agent process to hand off to — this class *is*
 * the orchestrator.
 */

export type AgentTaskEvents = {
  onStep?: (step: number, toolCall: AgentToolCall, decision: AgentScanDecision) => void
  onSecurityBlock?: (state: CircuitBreakerState) => void
  onStatus?: (message: string) => void
}

export type AgentTaskOptions = {
  taskId: string
  goal: string
  targetId: number
  maxSteps?: number
  signal?: AbortSignal
  events?: AgentTaskEvents
  visualFeedback?: boolean
  onApprovalRequest?: ApprovalHandler
  onOpenTab?: (url?: string) => Promise<number | null>
}

/** One planning round trip may queue several actions; each still costs one step. */
const DEFAULT_MAX_STEPS = 150

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Identifies *what was acted on*, not just what happened to it. Working
 * memory is the planner's only continuity between steps — a summary that
 * says "The page changed" without naming the element gives it no way to tell
 * "I already did this one" from "I haven't tried this one yet", which is
 * exactly the gap that lets it reclick the same element over and over.
 */
function describeToolCall(toolCall: AgentToolCall): string {
  const args = toolCall.arguments ?? {}
  const target = typeof args.target === 'string' ? args.target : null
  const extra = ['value', 'text', 'key', 'url', 'note', 'summary']
    .map((key) => (typeof args[key] === 'string' ? String(args[key]) : null))
    .find((value): value is string => Boolean(value))

  const parts: string[] = [toolCall.tool]
  if (target) parts.push(target)
  if (extra) parts.push(`"${extra.slice(0, 60)}"`)
  return parts.join(' ')
}

/** Outcome of running one queued action. `null` means "keep going in this queue". */
type ActionOutcome = AgentTaskResult | null

export class AgentTask {
  readonly taskId: string
  readonly goal: string
  private targetId: number
  private readonly maxSteps: number
  private readonly signal?: AbortSignal
  private readonly events: AgentTaskEvents
  private readonly visualFeedback: boolean
  private readonly onApprovalRequest?: ApprovalHandler
  private readonly onOpenTab?: (url?: string) => Promise<number | null>

  private readonly memory: AgentWorkingMemory
  private readonly breaker = new AgentCircuitBreaker()
  private readonly security: AgentSecurityPipeline
  private stepCount = 0
  /**
   * A malformed plan (missing argument, invented tool, bad JSON) is the LLM
   * mis-stepping, not the task failing — the fix is to tell it what went
   * wrong and let it try again, not end the run. This counts *consecutive*
   * planning failures specifically, separately from `stepCount`, because a
   * failed plan never reaches an action and so never advances the step
   * count — without its own cap this could otherwise retry forever.
   */
  private plannerFailureStreak = 0
  private static readonly MAX_PLANNER_FAILURES = 12

  constructor(options: AgentTaskOptions) {
    this.taskId = options.taskId
    this.goal = options.goal.trim()
    this.targetId = options.targetId
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
    this.signal = options.signal
    this.events = options.events ?? {}
    this.visualFeedback = options.visualFeedback !== false
    this.onApprovalRequest = options.onApprovalRequest
    this.onOpenTab = options.onOpenTab
    this.memory = new AgentWorkingMemory(this.goal)
    this.security = new AgentSecurityPipeline(this.taskId)
  }

  async run(): Promise<AgentTaskResult> {
    if (!isBrowserRuntimeAvailable()) {
      return this.finalResult('failed', 'Browser runtime is not available in this environment.')
    }

    if (this.visualFeedback) {
      await setAgentOverlay(this.targetId, true).catch(() => undefined)
    }

    try {
      while (this.stepCount < this.maxSteps) {
        if (this.signal?.aborted) {
          return this.finalResult('failed', 'Task was stopped by the user.', 'cancelled')
        }

        this.events.onStatus?.('Scanning the page and planning the next action…')

        const stateResult = await extractPageState(this.targetId)
        if (!stateResult.ok) {
          const errorMsg = 'error' in stateResult && stateResult.error ? stateResult.error.message : 'Unknown error'
          return this.finalResult('failed', `Could not read the page: ${errorMsg}`, 'action_failed')
        }
        const pageState = stateResult.data
        this.memory.setCurrentPage(pageState.url)

        let plan: AgentPlanResponse
        let decision: AgentScanDecision | null
        try {
          // Planning and the security scan run concurrently — the scan does not
          // wait on the plan, and no action from the plan executes until the
          // scan verdict is in.
          ;[plan, decision] = await Promise.all([
            requestPlan(this.goal, this.memory, pageState, this.signal),
            this.security.scanActivePage(this.targetId, this.signal),
          ])
        } catch (error) {
          if (isAbortError(error)) {
            return this.finalResult('failed', 'Task was stopped by the user.', 'cancelled')
          }
          if (error instanceof AgentSecurityScanError) {
            return this.finalResult('failed', error.message, 'scan_failed')
          }
          if (error instanceof AgentPlanError) {
            // 'unavailable' means no LLM provider is configured at all — no
            // amount of retrying changes that. Every other kind (malformed
            // JSON, a missing required argument, a transient provider error)
            // is the kind of thing the *next* planning call routinely fixes
            // on its own, especially once the failure itself is visible in
            // working memory for the model to react to.
            if (error.kind === 'unavailable') {
              return this.finalResult('failed', error.message, 'planner_failed')
            }

            this.plannerFailureStreak += 1
            this.memory.recordFailure('plan', error.message, error.kind)
            if (this.plannerFailureStreak >= AgentTask.MAX_PLANNER_FAILURES) {
              return this.finalResult('failed', `The planner kept failing: ${error.message}`, 'planner_failed')
            }

            const backoffMs = Math.min(500 * Math.pow(1.5, this.plannerFailureStreak - 1), 4000)
            this.events.onStatus?.(`Planner error, retrying: ${error.message}`)
            await new Promise((resolve) => setTimeout(resolve, backoffMs))
            continue
          }
          throw error
        }

        this.plannerFailureStreak = 0

        const allowed = this.breaker.applyScanDecision(decision)
        if (!allowed) {
          const state = this.breaker.snapshot
          this.events.onSecurityBlock?.(state)
          return {
            taskId: this.taskId,
            status: 'blocked',
            message: state.message,
            steps: this.stepCount,
            reason: state.reason ?? undefined,
            decision: state.decision,
          }
        }

        const outcome = await this.executeQueue(plan, pageState, decision)
        if (outcome) return outcome
        // outcome === null: the whole queue landed cleanly — loop back and plan
        // the next batch against a freshly extracted page state.
      }

      return this.finalResult('failed', `Stopped after reaching the ${this.maxSteps}-step limit.`, 'step_limit')
    } finally {
      this.security.endTask()
      if (this.visualFeedback) {
        await setAgentOverlay(this.targetId, false).catch(() => undefined)
      }
    }
  }

  /** Runs every queued action in order. Returns a final result, or null to keep planning. */
  private async executeQueue(
    plan: AgentPlanResponse,
    pageState: PageStateSnapshot,
    decision: AgentScanDecision,
  ): Promise<ActionOutcome> {
    for (const toolCall of plan.tool_calls) {
      if (this.stepCount >= this.maxSteps) return null // outer loop reports the limit
      if (this.signal?.aborted) {
        return this.finalResult('failed', 'Task was stopped by the user.', 'cancelled')
      }

      const approvalRequest = approvalFor(toolCall, pageState, {
        lowConfidence: plan.needs_user_confirmation,
        confidence: plan.confidence,
      })

      if (approvalRequest) {
        if (!this.onApprovalRequest) {
          this.memory.recordFailure(toolCall.tool, 'This action needs approval, but nothing can ask for it here.')
          this.memory.incrementRetries()
          return null
        }

        const granted = await this.onApprovalRequest(approvalRequest)
        if (this.signal?.aborted) {
          return this.finalResult('failed', 'Task was stopped by the user.', 'cancelled')
        }
        if (!granted) {
          return this.finalResult('failed', `You declined: ${approvalRequest.summary}`, 'declined')
        }
      }

      if (isTerminalTool(toolCall)) {
        const summary = typeof toolCall.arguments?.summary === 'string' && toolCall.arguments.summary
          ? toolCall.arguments.summary
          : 'Goal achieved.'
        this.recordStep(toolCall, decision)
        return this.finalResult('completed', summary)
      }

      if (toolCall.tool === 'open_tab') {
        const outcome = await this.runOpenTab(toolCall, decision)
        if (outcome) return outcome
        return null // target changed — the old page state is no longer valid
      }

      if (toolCall.tool === 'extract') {
        const note = typeof toolCall.arguments?.note === 'string' && toolCall.arguments.note
          ? toolCall.arguments.note
          : 'Recorded a finding.'
        this.recordStep(toolCall, decision)
        this.memory.recordStep('extract', note, true)
        continue
      }

      const resolved = resolveToolCall(toolCall)
      if (!resolved) {
        this.recordStep(toolCall, decision)
        this.memory.recordFailure(toolCall.tool, `${describeToolCall(toolCall)} — not supported by the browser runtime.`)
        this.memory.incrementRetries()
        return null
      }

      const execResult = await invokeRuntime(this.targetId, resolved.command, resolved.params as never)
      this.recordStep(toolCall, decision)

      if (this.signal?.aborted) {
        return this.finalResult('failed', 'Task was stopped by the user.', 'cancelled')
      }

      if (!execResult.ok) {
        const errorMsg = 'error' in execResult && execResult.error ? execResult.error.message : 'Action failed'
        const errorCode = 'error' in execResult && execResult.error ? execResult.error.code : undefined
        this.memory.recordFailure(
          toolCall.tool,
          `${describeToolCall(toolCall)} — ${errorMsg}`,
          errorCode,
        )
        this.memory.incrementRetries()
        return null
      }

      const verification = 'verification' in execResult.data ? execResult.data.verification : undefined
      if (verification && !verification.verified) {
        // The command dispatched without error, but nothing observable changed —
        // that is evidence of a wrong element or a no-op, not progress.
        let hint = verification.reason
        if (toolCall.tool === 'press_key' && toolCall.arguments?.key === 'Enter') {
          hint += ' (If submitting a filter or setting, find and click the nearby apply/submit button instead)'
        }
        this.memory.recordFailure(toolCall.tool, `${describeToolCall(toolCall)} — ${hint}`, 'NOT_VERIFIED')
        this.memory.incrementRetries()
        return null
      }

      this.memory.recordStep(
        toolCall.tool,
        `${describeToolCall(toolCall)} — ${verification?.reason ?? 'completed'}`,
        true,
      )
      this.memory.resetRetries()

      if (toolCall.tool === 'navigate') return null // element ids from the old page are gone
    }

    return null
  }

  private async runOpenTab(toolCall: AgentToolCall, decision: AgentScanDecision): Promise<AgentTaskResult | null> {
    const url = typeof toolCall.arguments?.url === 'string' ? toolCall.arguments.url : undefined

    if (!this.onOpenTab) {
      this.recordStep(toolCall, decision)
      this.memory.recordFailure('open_tab', 'Opening new tabs is not supported in this context.')
      this.memory.incrementRetries()
      return null
    }

    let newTargetId: number | null
    try {
      newTargetId = await this.onOpenTab(url)
    } catch (error) {
      this.recordStep(toolCall, decision)
      this.memory.recordFailure('open_tab', error instanceof Error ? error.message : 'Failed to open a new tab.')
      this.memory.incrementRetries()
      return null
    }

    this.recordStep(toolCall, decision)

    if (newTargetId === null) {
      this.memory.recordFailure('open_tab', 'Opening the tab was cancelled or timed out.')
      this.memory.incrementRetries()
      return null
    }

    this.targetId = newTargetId
    this.memory.recordStep('open_tab', `Opened a new tab${url ? ` at ${url}` : ''}.`, true)
    this.memory.resetRetries()
    return null
  }

  private recordStep(toolCall: AgentToolCall, decision: AgentScanDecision): void {
    this.stepCount += 1
    this.events.onStep?.(this.stepCount, toolCall, decision)
  }

  private finalResult(
    status: AgentTaskResult['status'],
    message: string,
    reason?: AgentAbortReason,
  ): AgentTaskResult {
    return { taskId: this.taskId, status, message, steps: this.stepCount, reason }
  }
}
