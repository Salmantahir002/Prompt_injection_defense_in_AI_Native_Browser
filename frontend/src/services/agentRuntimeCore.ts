import type {
  AgentAbortReason,
  AgentPlanResponse,
  AgentTaskResult,
  AgentToolCall,
} from '../types/agentTypes'
import type { PageStateSnapshot } from '../types/browserRuntimeTypes'
import { approvalFor, type ApprovalHandler } from './agentApprovalPolicy'
import { AgentWorkingMemory } from './agentWorkingMemory'
import { AgentPlanError, requestPlan } from './agentApiClient'
import { extractPageState, invokeRuntime, isBrowserRuntimeAvailable, setAgentOverlay } from './browserRuntime'
import { isTerminalTool, resolveToolCall } from './agentToolRegistry'
import { agentBrowserMemory } from './agentBrowserMemory'

/**
 * The agent loop.
 *
 * Runs entirely in the renderer: every browser action goes out over
 * `invokeRuntime` to the CDP-native Browser Runtime (native input, verified
 * before/after) and every plan comes from the backend planner.
 *
 * Security scanning has been removed from the agent execution path to
 * eliminate the latency overhead of the DL classifier on every iteration.
 * Users can still manually scan any page via the toolbar "Scan Page" button
 * which uses its own independent endpoint (POST /security/check-webpage).
 *
 * There is no main-process agent process to hand off to — this class *is*
 * the orchestrator.
 */

export type AgentTaskEvents = {
  onStep?: (step: number, toolCall: AgentToolCall) => void
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
  private readonly actionHistory: string[] = []
  private static readonly STAGNATION_WINDOW = 9
  private static readonly STAGNATION_THRESHOLD = 3

  /** Builds an action signature to detect repetitive non-progressing actions. */
  private buildActionSignature(toolCall: AgentToolCall, pageState: PageStateSnapshot): string {
    const args = toolCall.arguments ?? {}
    const target = typeof args.target === 'string' ? args.target : ''
    const key = typeof args.key === 'string' ? args.key : ''
    const url = typeof args.url === 'string' ? args.url : ''
    return `${pageState.url}|${toolCall.tool}|${target}|${key}|${url}`
  }

  /**
   * Tracks actions in a rolling window. Returns true if the same action
   * repeats 3 or more times without forward progress.
   */
  private detectStagnation(toolCall: AgentToolCall, pageState: PageStateSnapshot): boolean {
    const signature = this.buildActionSignature(toolCall, pageState)
    this.actionHistory.push(signature)
    if (this.actionHistory.length > AgentTask.STAGNATION_WINDOW) {
      this.actionHistory.shift()
    }

    const count = this.actionHistory.filter((sig) => sig === signature).length
    return count >= AgentTask.STAGNATION_THRESHOLD
  }

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

        this.events.onStatus?.('Planning the next action…')

        const stateResult = await extractPageState(this.targetId)
        if (!stateResult.ok) {
          const errorMsg = 'error' in stateResult && stateResult.error ? stateResult.error.message : 'Unknown error'
          return this.finalResult('failed', `Could not read the page: ${errorMsg}`, 'action_failed')
        }
        const pageState = stateResult.data
        this.memory.setCurrentPage(pageState.url)

        let plan: AgentPlanResponse
        try {
          plan = await requestPlan(this.goal, this.memory, pageState, this.signal)
        } catch (error) {
          if (isAbortError(error)) {
            return this.finalResult('failed', 'Task was stopped by the user.', 'cancelled')
          }
          if (error instanceof AgentPlanError) {
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
        if (plan.thought) {
          this.memory.setLastThought(plan.thought)
        }

        const outcome = await this.executeQueue(plan, pageState)
        if (outcome) return outcome
      }

      return this.finalResult('failed', `Stopped after reaching the ${this.maxSteps}-step limit.`, 'step_limit')
    } finally {
      if (this.visualFeedback) {
        await setAgentOverlay(this.targetId, false).catch(() => undefined)
      }
    }
  }

  /** Runs every queued action in order. Returns a final result, or null to keep planning. */
  private async executeQueue(
    plan: AgentPlanResponse,
    pageState: PageStateSnapshot,
  ): Promise<ActionOutcome> {
    for (const toolCall of plan.tool_calls) {
      if (this.stepCount >= this.maxSteps) return null // outer loop reports the limit
      if (this.signal?.aborted) {
        return this.finalResult('failed', 'Task was stopped by the user.', 'cancelled')
      }

      const targetIdArg = typeof toolCall.arguments?.target === 'string' ? toolCall.arguments.target : ''

      // Loop/Stagnation Detector: prevent repeating identical actions 3+ times
      if (!isTerminalTool(toolCall) && this.detectStagnation(toolCall, pageState)) {
        const desc = describeToolCall(toolCall)
        if (targetIdArg) {
          this.memory.recordInvalidElement(targetIdArg)
        }
        this.memory.recordFailure(
          toolCall.tool,
          `Loop / stagnation detected: '${desc}' was repeated 3+ times without forward progress. Try an alternative control or strategy.`,
          'LOOP_DETECTED',
        )
        this.memory.incrementRetries()
        this.events.onStatus?.(`Loop detected on '${toolCall.tool}'. Replanning alternative action...`)
        return null
      }

      // Pre-execution guard: fast microsecond check against blacklisted or disabled elements
      if (targetIdArg) {
        if (this.memory.isElementInvalid(targetIdArg)) {
          this.memory.recordFailure(
            toolCall.tool,
            `Target element '${targetIdArg}' was previously non-responsive or failed. Skipping dead element to replan.`,
            'ELEMENT_NOT_INTERACTABLE',
          )
          this.memory.incrementRetries()
          this.events.onStatus?.(`Skipping dead element '${targetIdArg}'. Replanning...`)
          return null
        }

        const knownElement = pageState.elements.find((el) => el.id === targetIdArg)
        if (knownElement?.disabled && (toolCall.tool === 'click' || toolCall.tool === 'fill')) {
          this.memory.recordInvalidElement(targetIdArg)
          this.memory.recordFailure(
            toolCall.tool,
            `Element '${targetIdArg}' ("${knownElement.name || knownElement.role}") is disabled and cannot be interacted with.`,
            'ELEMENT_NOT_INTERACTABLE',
          )
          this.memory.incrementRetries()
          this.events.onStatus?.(`Element '${targetIdArg}' is disabled. Replanning...`)
          return null
        }
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
        this.recordStep(toolCall)
        return this.finalResult('completed', summary)
      }

      if (toolCall.tool === 'open_tab') {
        const outcome = await this.runOpenTab(toolCall)
        if (outcome) return outcome
        return null // target changed — the old page state is no longer valid
      }

      if (toolCall.tool === 'extract') {
        const note = typeof toolCall.arguments?.note === 'string' && toolCall.arguments.note
          ? toolCall.arguments.note
          : 'Recorded a finding.'
        this.recordStep(toolCall)
        this.memory.recordFinding(note)
        this.memory.recordStep('extract', note, true)
        continue
      }

      // Graceful handling of blocked side pages prior to runtime dispatch:
      if (toolCall.tool === 'navigate') {
        const targetUrl = typeof toolCall.arguments?.url === 'string' ? toolCall.arguments.url : ''
        if (targetUrl && agentBrowserMemory.isBlocked(targetUrl)) {
          this.recordStep(toolCall)
          this.memory.recordFailure(
            'navigate',
            `Navigation to '${targetUrl}' was prevented because the origin is blocked/untrusted. Find an alternative route or proceed with current page content.`,
            'NAVIGATION_BLOCKED',
          )
          this.memory.incrementRetries()
          this.events.onStatus?.(`Navigation to blocked origin '${targetUrl}' was prevented. Replanning alternative path...`)
          return null
        }
      }

      const resolved = resolveToolCall(toolCall)
      if (!resolved) {
        this.recordStep(toolCall)
        this.memory.recordFailure(toolCall.tool, `${describeToolCall(toolCall)} — not supported by the browser runtime.`)
        this.memory.incrementRetries()
        return null
      }

      const execResult = await invokeRuntime(this.targetId, resolved.command, resolved.params as never)
      this.recordStep(toolCall)

      if (this.signal?.aborted) {
        return this.finalResult('failed', 'Task was stopped by the user.', 'cancelled')
      }

      if (!execResult.ok) {
        const errorMsg = 'error' in execResult && execResult.error ? execResult.error.message : 'Action failed'
        const errorCode = 'error' in execResult && execResult.error ? execResult.error.code : undefined

        if (targetIdArg) {
          this.memory.recordInvalidElement(targetIdArg)
        }

        // Graceful handling of blocked navigation mid-task:
        if (toolCall.tool === 'navigate' && errorCode === 'NAVIGATION_BLOCKED') {
          const navUrl = typeof toolCall.arguments?.url === 'string' ? toolCall.arguments.url : 'url'
          this.memory.recordFailure(
            'navigate',
            `Navigation to '${navUrl}' was blocked by browser security policy. Continuing with alternative action.`,
            'NAVIGATION_BLOCKED',
          )
          this.memory.incrementRetries()
          this.events.onStatus?.(`Navigation to '${navUrl}' was blocked. Replanning alternative action...`)
          return null
        }

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
        if (targetIdArg) {
          this.memory.recordInvalidElement(targetIdArg)
        }
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

      if (toolCall.tool === 'navigate') {
        return null // element ids from the old page are gone
      }
    }

    return null
  }

  private async runOpenTab(toolCall: AgentToolCall): Promise<AgentTaskResult | null> {
    const url = typeof toolCall.arguments?.url === 'string' ? toolCall.arguments.url : undefined

    if (url && agentBrowserMemory.isBlocked(url)) {
      this.recordStep(toolCall)
      this.memory.recordFailure(
        'open_tab',
        `Opening tab to '${url}' was prevented because this origin is blocked/untrusted.`,
        'NAVIGATION_BLOCKED',
      )
      this.memory.incrementRetries()
      this.events.onStatus?.(`Blocked tab open was prevented for '${url}'. Replanning...`)
      return null
    }

    if (!this.onOpenTab) {
      this.recordStep(toolCall)
      this.memory.recordFailure('open_tab', 'Opening new tabs is not supported in this context.')
      this.memory.incrementRetries()
      return null
    }

    let newTargetId: number | null
    try {
      newTargetId = await this.onOpenTab(url)
    } catch (error) {
      this.recordStep(toolCall)
      this.memory.recordFailure('open_tab', error instanceof Error ? error.message : 'Failed to open a new tab.')
      this.memory.incrementRetries()
      return null
    }

    this.recordStep(toolCall)

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

  private recordStep(toolCall: AgentToolCall): void {
    this.stepCount += 1
    this.events.onStep?.(this.stepCount, toolCall)
  }

  private finalResult(
    status: AgentTaskResult['status'],
    message: string,
    reason?: AgentAbortReason,
  ): AgentTaskResult {
    return { taskId: this.taskId, status, message, steps: this.stepCount, reason }
  }
}
