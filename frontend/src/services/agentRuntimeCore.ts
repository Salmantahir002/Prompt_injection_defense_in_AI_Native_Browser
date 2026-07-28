import type {
  AgentIterationOutcome,
  AgentScanDecision,
  AgentTaskResult,
  AgentToolCall,
} from '../types/agentTypes'
import type { ActionAck, PageStateSnapshot, SemanticElement } from '../types/browserRuntimeTypes'
import { AgentCircuitBreaker, AgentCircuitBreakerOpen, type CircuitBreakerState } from './agentCircuitBreaker'
import { AgentPlanError, requestPlan } from './agentApiClient'
import { approvalFor, type ApprovalHandler, type ApprovalRequest } from './agentApprovalPolicy'
import { agentBrowserMemory } from './agentBrowserMemory'
import { AgentRecoveryEngine, refindElement, type RecoveryContext } from './agentRecoveryEngine'
import { AgentSecurityPipeline } from './agentSecurityPipeline'
import { AgentWorkingMemory } from './agentWorkingMemory'
import { isTerminalTool, resolveToolCall } from './agentToolRegistry'
import { invokeRuntime, setAgentOverlay } from './browserRuntime'

/**
 * The agent runtime core: one security-gated iteration, and the loop over it.
 *
 * Each iteration runs two independent pipelines concurrently —
 *
 *   planning:  page state → planner → tool call
 *   security:  deep CDP snapshot → /agent/scan-active-page → verdict
 *
 * — because the planner's latency and the scanner's are both on the critical
 * path and neither depends on the other's result. The concurrency is safe
 * precisely because of the ordering rule that follows it: the planner may
 * *produce* an action while a scan is in flight, but nothing may *execute*
 * until the verdict is in. An unsafe verdict discards the action.
 *
 * Verification and recovery (Phase 6) and multi-step queues (Phase 7) attach
 * to `runIteration`; the seams are marked below.
 */

const DEFAULT_MAX_STEPS = 25

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
  /**
   * Asks the user to approve a consequential action. Omitting it means no
   * approval can be obtained, so such actions are refused rather than run
   * silently.
   */
  onApprovalRequest?: ApprovalHandler
  /**
   * Opens a new browser tab and resolves to its Browser Runtime target id, or
   * null if the tab could not be opened. Supplied by the UI, which owns the tab
   * strip. Without it the `open_tab` tool is refused rather than faked.
   */
  onOpenTab?: (url?: string) => Promise<number | null>
}

export class AgentTask {
  readonly taskId: string
  readonly goal: string

  /** Not readonly: `open_tab` re-points the task at the tab it just opened. */
  private targetId: number
  private readonly maxSteps: number
  private readonly signal?: AbortSignal
  private readonly events: AgentTaskEvents
  private readonly onApprovalRequest?: ApprovalHandler
  private readonly onOpenTab?: (url?: string) => Promise<number | null>

  private readonly memory: AgentWorkingMemory
  private readonly breaker = new AgentCircuitBreaker()
  private readonly security: AgentSecurityPipeline
  private readonly recovery = new AgentRecoveryEngine()

  private steps = 0
  /** Cached so a re-find can match the element the planner actually chose. */
  private lastPageState: PageStateSnapshot | null = null

  constructor(options: AgentTaskOptions) {
    this.taskId = options.taskId
    this.goal = options.goal.trim()
    this.targetId = options.targetId
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
    this.signal = options.signal
    this.events = options.events ?? {}
    this.onApprovalRequest = options.onApprovalRequest
    this.onOpenTab = options.onOpenTab

    this.memory = new AgentWorkingMemory(this.goal)
    this.security = new AgentSecurityPipeline(this.taskId)

    if (this.events.onSecurityBlock) {
      this.breaker.onTrip(this.events.onSecurityBlock)
    }
  }

  get circuitBreakerState(): CircuitBreakerState {
    return this.breaker.snapshot
  }

  /**
   * Runs the task to completion.
   *
   * The first iteration scans before any action is taken, so the page the task
   * starts on is validated exactly like every page reached later.
   */
  async run(): Promise<AgentTaskResult> {
    if (!this.goal) {
      return { taskId: this.taskId, status: 'failed', message: 'A goal is required.', steps: 0 }
    }

    // Lights the page up for the duration of the task. Cosmetic, so it is
    // never awaited for correctness and never allowed to fail the run.
    void setAgentOverlay(this.targetId, true)

    try {
      while (this.steps < this.maxSteps) {
        if (this.signal?.aborted) {
          return this.result('failed', 'Task cancelled.', 'cancelled')
        }

        const outcome = await this.runIteration()
        this.steps += 1

        if (outcome.status === 'finished') {
          return { taskId: this.taskId, status: 'completed', message: outcome.message, steps: this.steps }
        }
        if (outcome.status === 'aborted') {
          const blocked = outcome.reason === 'injection_detected' || outcome.reason === 'scan_failed'
          return {
            taskId: this.taskId,
            status: blocked ? 'blocked' : 'failed',
            message: outcome.message,
            steps: this.steps,
            reason: outcome.reason,
            decision: outcome.decision ?? null,
          }
        }
      }

      return this.result('failed', `Stopped after ${this.maxSteps} steps without completing the goal.`, 'step_limit')
    } finally {
      this.security.endTask()
      void setAgentOverlay(this.targetId, false)
    }
  }

  /** One planning + scanning + execution cycle. */
  async runIteration(): Promise<AgentIterationOutcome> {
    const stateResult = await invokeRuntime(this.targetId, 'extractPageState', {})
    if (!stateResult.ok) {
      return { status: 'aborted', reason: 'action_failed', message: `Could not read the page: ${stateResult.error.message}` }
    }

    const pageState = stateResult.data
    this.lastPageState = pageState
    this.memory.setCurrentPage(pageState.url)

    // ---- the two pipelines, in parallel -------------------------------
    // allSettled, not all: a planner failure must not cancel the scan, and a
    // scan failure must not be masked by a planner error.
    const [planOutcome, scanOutcome] = await Promise.allSettled([
      this.plan(pageState),
      this.scan(),
    ])

    // ---- the ordering rule: the verdict decides, always ----------------
    const decision = scanOutcome.status === 'fulfilled' ? scanOutcome.value : null
    if (!this.breaker.applyScanDecision(decision)) {
      const state = this.breaker.snapshot
      const scanError = scanOutcome.status === 'rejected' ? String(scanOutcome.reason) : ''
      // A site that served an injection also loses everything the agent
      // learned about it while it was trusted.
      if (state.reason === 'injection_detected') agentBrowserMemory.markBlocked(pageState.url)
      // The planner's action, if one arrived, is discarded unexecuted.
      return {
        status: 'aborted',
        reason: state.reason ?? 'scan_failed',
        message: state.message || scanError,
        decision,
      }
    }

    if (planOutcome.status === 'rejected') {
      return this.planFailure(planOutcome.reason)
    }

    const plan = planOutcome.value
    const queue = plan.tool_calls?.length ? plan.tool_calls : [plan.tool_call]
    agentBrowserMemory.recordVisit(pageState.url)

    let lastOutcome: AgentIterationOutcome = {
      status: 'continue', message: '', decision,
    }

    // The queue exists to save planning round trips, not to run unsupervised.
    // It is abandoned the moment the page stops matching what was planned.
    for (const toolCall of queue) {
      const approval = approvalFor(toolCall, pageState, {
        lowConfidence: plan.needs_user_confirmation,
        confidence: plan.confidence,
      })

      if (approval) {
        const granted = await this.requestApproval(approval)
        if (!granted) {
          return {
            status: 'aborted',
            reason: approval.risk === 'low_confidence' ? 'needs_confirmation' : 'declined',
            message: `Stopped: ${approval.summary} was not approved.`,
            toolCall,
            decision,
          }
        }
      }

      this.events.onStep?.(this.steps + 1, toolCall, decision as AgentScanDecision)

      if (isTerminalTool(toolCall)) {
        const summary = typeof toolCall.arguments.summary === 'string' ? toolCall.arguments.summary : 'Task complete.'
        this.memory.recordStep('finish', summary)
        return { status: 'finished', message: summary, toolCall, decision }
      }

      if (toolCall.tool === 'extract') {
        const note = typeof toolCall.arguments.note === 'string' ? toolCall.arguments.note : ''
        this.memory.recordStep('extract', note)
        lastOutcome = { status: 'continue', message: note, toolCall, decision }
        continue
      }

      if (toolCall.tool === 'open_tab') {
        return this.openTab(toolCall, decision)
      }

      lastOutcome = await this.execute(toolCall, decision)
      if (lastOutcome.status !== 'continue') return lastOutcome

      this.rememberSuccess(pageState, toolCall)

      // Anything that moved the page invalidates the rest of the queue: those
      // actions were planned against a page that no longer exists, and more
      // importantly the new page has not been security-scanned yet.
      if (await this.pageMovedOn(pageState.url)) {
        this.events.onStatus?.('The page changed; re-scanning before continuing.')
        return { status: 'continue', message: 'Page changed mid-plan; replanning.', toolCall, decision }
      }
    }

    return lastOutcome
  }

  /**
   * A consequential action with no way to ask is refused, not run. Silence is
   * not consent, and this is the one place where defaulting to "proceed" would
   * hand an injected page exactly what it wants.
   */
  private async requestApproval(request: ApprovalRequest): Promise<boolean> {
    if (!this.onApprovalRequest) {
      this.events.onStatus?.(`Cannot ask for approval, so "${request.summary}" was refused.`)
      return false
    }

    this.events.onStatus?.(`Waiting for you: ${request.summary}`)
    try {
      return await this.onApprovalRequest(request)
    } catch {
      return false
    }
  }

  /**
   * Opens a new tab and re-points the task at it.
   *
   * The tab strip lives in the renderer, not in the Browser Runtime, so this
   * cannot be a runtime command — the runtime drives an existing target and has
   * no concept of a tab. Switching `targetId` is the essential half: without it
   * the agent would open a tab and carry on driving the old one.
   *
   * Returns `continue` rather than executing the rest of the queue, because the
   * new tab is a different page that has not been security-scanned yet. The
   * next iteration scans it before anything touches it.
   */
  private async openTab(toolCall: AgentToolCall, decision: AgentScanDecision | null): Promise<AgentIterationOutcome> {
    if (!this.onOpenTab) {
      const message = 'This build cannot open tabs, so the tab was not opened.'
      this.memory.recordFailure('open_tab', message)
      return { status: 'aborted', reason: 'action_failed', message, toolCall, decision }
    }

    const url = typeof toolCall.arguments.url === 'string' ? toolCall.arguments.url : undefined

    // Stays null if onOpenTab throws, which the null check below then handles.
    let newTargetId: number | null = null
    try {
      newTargetId = await this.onOpenTab(url)
    } catch (error) {
      this.events.onStatus?.(`Could not open a tab: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (newTargetId === null) {
      const message = 'The new tab did not attach, so the agent stayed on the current tab.'
      this.memory.recordFailure('open_tab', message)
      this.memory.incrementRetries()
      // Recoverable: the planner can pick a different route next iteration.
      return { status: 'continue', message, toolCall, decision }
    }

    // The overlay follows the agent: clear it from the tab being left behind,
    // or that tab keeps breathing after the agent has moved on.
    void setAgentOverlay(this.targetId, false)
    this.targetId = newTargetId
    void setAgentOverlay(this.targetId, true)

    // The breaker's verdict covered the previous page; the new tab is unscanned
    // until the next iteration, which is exactly why the queue stops here.
    this.memory.recordStep('open_tab', url ? `Opened a new tab at ${url}` : 'Opened a new tab')
    this.memory.setCurrentPage(url ?? '')
    this.events.onStatus?.(url ? `Opened a new tab at ${url}.` : 'Opened a new tab.')

    return { status: 'continue', message: 'Opened a new tab; scanning it before continuing.', toolCall, decision }
  }

  private async pageMovedOn(plannedUrl: string): Promise<boolean> {
    const described = await invokeRuntime(this.targetId, 'describeTarget', {})
    return described.ok && described.data.url !== plannedUrl
  }

  private rememberSuccess(pageState: PageStateSnapshot, toolCall: AgentToolCall): void {
    const target = typeof toolCall.arguments?.target === 'string'
      ? pageState.elements.find((element) => element.id === toolCall.arguments.target)
      : undefined

    agentBrowserMemory.recordSuccess(pageState.url, toolCall.tool, target)
  }

  private async plan(pageState: PageStateSnapshot) {
    return requestPlan(this.goal, this.memory, pageState, this.signal)
  }

  private async scan(): Promise<AgentScanDecision> {
    return this.security.scanActivePage(this.targetId, this.signal)
  }

  private planFailure(reason: unknown): AgentIterationOutcome {
    const message = reason instanceof Error ? reason.message : String(reason)
    if (reason instanceof AgentPlanError && reason.kind === 'invalid_plan') {
      // Recoverable: the model produced something unexecutable. Record it and
      // continue — the next iteration replans with the failure in memory.
      this.memory.recordFailure('plan', message, 'invalid_plan')
      this.memory.incrementRetries()

      const plan = this.recovery.plan({ toolCall: { tool: 'plan', arguments: {} }, message })
      if (plan.strategy === 'abort') {
        return { status: 'aborted', reason: 'planner_failed', message: plan.message }
      }

      this.events.onStatus?.(`Planner produced an unusable action; replanning. ${message}`)
      return { status: 'continue', message: `Replanning after an unusable action. ${message}` }
    }

    return { status: 'aborted', reason: 'planner_failed', message }
  }

  /**
   * Executes a validated tool call, verifies it took effect, and runs the
   * recovery ladder when it did not. Never reached while the breaker is
   * tripped: `assertClosed` is re-checked before every attempt, including
   * retries, so a scan that trips mid-recovery still stops the action.
   */
  private async execute(toolCall: AgentToolCall, decision: AgentScanDecision | null): Promise<AgentIterationOutcome> {
    let currentCall = toolCall

    for (;;) {
      this.breaker.assertClosed()

      const resolved = resolveToolCall(currentCall)
      if (!resolved) {
        const message = `Tool "${currentCall.tool}" is not available to the runtime.`
        this.memory.recordFailure(currentCall.tool, message)
        return { status: 'aborted', reason: 'action_failed', message, toolCall: currentCall, decision }
      }

      const result = await invokeRuntime(this.targetId, resolved.command, resolved.params as never)

      let context: RecoveryContext | null = null
      if (!result.ok) {
        context = { toolCall: currentCall, errorCode: result.error.code, message: result.error.message }
      } else {
        const verification = (result.data as ActionAck).verification
        if (verification && !verification.verified) {
          // The call succeeded but nothing happened — a click on an overlay,
          // a keystroke into a field that never took focus.
          context = { toolCall: currentCall, unverified: true, message: verification.reason }
        }
      }

      if (!context) {
        this.memory.recordStep(currentCall.tool, describeToolCall(currentCall))
        this.memory.resetRetries()
        this.recovery.reset()
        return { status: 'continue', message: describeToolCall(currentCall), toolCall: currentCall, decision }
      }

      this.memory.recordFailure(currentCall.tool, context.message, context.errorCode)
      this.memory.incrementRetries()

      const plan = this.recovery.plan(context)
      this.events.onStatus?.(plan.message)

      if (plan.strategy === 'abort') {
        return { status: 'aborted', reason: 'action_failed', message: plan.message, toolCall: currentCall, decision }
      }
      if (plan.strategy === 'replan') {
        // Hand control back to the loop; the next iteration re-plans with the
        // failure now visible in working memory.
        return { status: 'continue', message: plan.message, toolCall: currentCall, decision }
      }

      const retargeted = await this.applyRecovery(plan.strategy, currentCall)
      if (!retargeted) {
        return {
          status: 'continue',
          message: `${plan.message} — could not recover locally, replanning.`,
          toolCall: currentCall,
          decision,
        }
      }

      currentCall = retargeted
    }
  }

  /**
   * Performs one rung of the ladder. Returns the (possibly retargeted) call to
   * attempt again, or null when the loop should replan instead.
   */
  private async applyRecovery(
    strategy: 'retry' | 'refind' | 'wait' | 'rebuild',
    toolCall: AgentToolCall,
  ): Promise<AgentToolCall | null> {
    if (strategy === 'retry') return toolCall

    if (strategy === 'wait') {
      await invokeRuntime(this.targetId, 'waitForDomStable', { timeoutMs: 5_000 })
      return toolCall
    }

    // refind and rebuild both need fresh state; the ids in the old plan are
    // stale the moment the page re-renders.
    const previousTarget = this.targetElement(toolCall)
    const fresh = await invokeRuntime(this.targetId, 'extractPageState', {})
    if (!fresh.ok) return null

    this.lastPageState = fresh.data
    if (strategy === 'rebuild') return null

    const relocated = refindElement(previousTarget, fresh.data)
    if (!relocated) return null

    return { ...toolCall, arguments: { ...toolCall.arguments, target: relocated.id } }
  }

  private targetElement(toolCall: AgentToolCall): SemanticElement | undefined {
    const target = toolCall.arguments?.target
    if (typeof target !== 'string' || !this.lastPageState) return undefined
    return this.lastPageState.elements.find((element) => element.id === target)
  }

  private result(status: AgentTaskResult['status'], message: string, reason?: AgentTaskResult['reason']): AgentTaskResult {
    return { taskId: this.taskId, status, message, steps: this.steps, reason }
  }
}

function describeToolCall(toolCall: AgentToolCall): string {
  const args = toolCall.arguments ?? {}
  const detail = ['target', 'url', 'value', 'text', 'key']
    .filter((name) => typeof args[name] === 'string')
    .map((name) => `${name}=${String(args[name]).slice(0, 60)}`)
    .join(' ')

  return detail ? `${toolCall.tool} ${detail}` : toolCall.tool
}

export { AgentCircuitBreakerOpen }
