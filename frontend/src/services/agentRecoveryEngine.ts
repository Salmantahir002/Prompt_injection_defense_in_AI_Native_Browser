import type { BrowserRuntimeErrorCode, PageStateSnapshot, SemanticElement } from '../types/browserRuntimeTypes'

/**
 * Recovery Engine.
 *
 * When an action fails or cannot be verified, this decides what to try before
 * bothering the planner. The ladder is ordered by cost:
 *
 *   retry → re-find element → wait for the page → rebuild state → replan → abort
 *
 * Cheap local recovery handles the common causes — a control that had not
 * finished rendering, an id invalidated by a re-render — without spending an
 * LLM call or losing the plan. Only when the page genuinely does not match the
 * planner's assumptions does it escalate.
 *
 * Some failures skip the ladder entirely. Retrying a blocked navigation or an
 * action awaiting human approval is not recovery, it is a loop.
 */

export type RecoveryStrategy = 'retry' | 'refind' | 'wait' | 'rebuild' | 'replan' | 'abort'

/**
 * What failed. Deliberately looser than `AgentToolCall` so planning failures,
 * which have no tool, can use the same attempt budget.
 */
export type RecoveryTarget = { tool: string; arguments?: Record<string, unknown> }

export type RecoveryContext = {
  toolCall: RecoveryTarget
  /** Runtime error code, when the action failed outright. */
  errorCode?: BrowserRuntimeErrorCode
  /** True when the action ran but the verification engine saw no effect. */
  unverified?: boolean
  message: string
}

export type RecoveryPlan = {
  strategy: RecoveryStrategy
  message: string
  /** How many recovery attempts this step has now consumed. */
  attempt: number
}

/** Failures where retrying is pointless or unsafe. */
const TERMINAL_CODES: ReadonlySet<BrowserRuntimeErrorCode> = new Set<BrowserRuntimeErrorCode>([
  'NAVIGATION_BLOCKED',
  'APPROVAL_REQUIRED',
  'TARGET_DETACHED',
  'NO_TARGET',
  'RUNTIME_UNAVAILABLE',
  'NOT_IMPLEMENTED',
])

/**
 * Where each failure enters the ladder. A stale element id is not fixed by
 * repeating the same call, so it starts at `refind`; a timeout usually means
 * the page was still working, so it starts at `wait`.
 */
const ENTRY_STRATEGY: Partial<Record<BrowserRuntimeErrorCode, RecoveryStrategy>> = {
  ELEMENT_NOT_FOUND: 'refind',
  ELEMENT_NOT_INTERACTABLE: 'wait',
  TIMEOUT: 'wait',
  CDP_ERROR: 'retry',
  INVALID_ARGUMENT: 'replan',
}

const LADDER: readonly RecoveryStrategy[] = ['retry', 'refind', 'wait', 'rebuild', 'replan']

const MAX_ATTEMPTS_PER_STEP = 3
const MAX_TOTAL_RECOVERIES = 8

export class AgentRecoveryEngine {
  private stepAttempts = 0
  private totalRecoveries = 0
  private lastStepKey = ''

  /** Called after a successful, verified action. */
  reset(): void {
    this.stepAttempts = 0
    this.lastStepKey = ''
  }

  get totalRecoveryCount(): number {
    return this.totalRecoveries
  }

  plan(context: RecoveryContext): RecoveryPlan {
    const stepKey = `${context.toolCall.tool}:${JSON.stringify(context.toolCall.arguments ?? {})}`
    if (stepKey !== this.lastStepKey) {
      this.lastStepKey = stepKey
      this.stepAttempts = 0
    }

    if (context.errorCode && TERMINAL_CODES.has(context.errorCode)) {
      return this.abort(`${context.message} (${context.errorCode} is not recoverable)`)
    }

    if (this.totalRecoveries >= MAX_TOTAL_RECOVERIES) {
      return this.abort(`Giving up after ${MAX_TOTAL_RECOVERIES} recovery attempts across the task.`)
    }

    this.stepAttempts += 1
    this.totalRecoveries += 1

    if (this.stepAttempts > MAX_ATTEMPTS_PER_STEP) {
      return this.abort(`"${context.toolCall.tool}" failed ${MAX_ATTEMPTS_PER_STEP} times: ${context.message}`)
    }

    const entry = context.errorCode ? ENTRY_STRATEGY[context.errorCode] : undefined
    // An unverified action is a different problem from a failed one: the call
    // succeeded, so repeating it once is reasonable before assuming the plan
    // itself was wrong.
    const startIndex = entry ? LADDER.indexOf(entry) : (context.unverified ? 0 : 0)
    const index = Math.min(startIndex + this.stepAttempts - 1, LADDER.length - 1)
    const strategy = LADDER[index]

    return { strategy, message: describeStrategy(strategy, context), attempt: this.stepAttempts }
  }

  private abort(message: string): RecoveryPlan {
    return { strategy: 'abort', message, attempt: this.stepAttempts }
  }
}

function describeStrategy(strategy: RecoveryStrategy, context: RecoveryContext): string {
  switch (strategy) {
    case 'retry':
      return `Retrying ${context.toolCall.tool}: ${context.message}`
    case 'refind':
      return `Looking for the element again after: ${context.message}`
    case 'wait':
      return `Waiting for the page to settle after: ${context.message}`
    case 'rebuild':
      return `Rebuilding the page state after: ${context.message}`
    case 'replan':
      return `Asking the planner for a different approach after: ${context.message}`
    default:
      return context.message
  }
}

/**
 * Re-locates an element the planner targeted, after a state rebuild changed
 * the ids. Matching is on role plus accessible name, which is what the planner
 * actually reasoned about — the numeric id was only ever a handle.
 */
export function refindElement(
  previousTarget: SemanticElement | undefined,
  freshState: PageStateSnapshot,
): SemanticElement | undefined {
  if (!previousTarget) return undefined

  const sameRoleAndName = freshState.elements.find(
    (element) => element.role === previousTarget.role && element.name === previousTarget.name,
  )
  if (sameRoleAndName) return sameRoleAndName

  // A control whose label changed slightly (a spinner suffix, a count) is
  // still worth matching, but only within the same role.
  const name = previousTarget.name.trim().toLowerCase()
  if (!name) return undefined

  return freshState.elements.find(
    (element) =>
      element.role === previousTarget.role &&
      (element.name.toLowerCase().includes(name) || name.includes(element.name.trim().toLowerCase())),
  )
}
