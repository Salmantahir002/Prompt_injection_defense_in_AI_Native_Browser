import type { AgentAbortReason, AgentScanDecision } from '../types/agentTypes'

/**
 * The runtime's hard stop.
 *
 * The planner may produce an action while a scan is still running — that
 * parallelism is the point — but no action may *execute* until the scan
 * returns. If the verdict is unsafe, the pending action is discarded, not
 * queued or retried, and the task is over.
 *
 * A tripped breaker never resets within a task. Re-arming it after a detected
 * injection would let a page that flickers between hostile and clean content
 * eventually get an action through.
 */

export type CircuitBreakerState = {
  tripped: boolean
  reason: AgentAbortReason | null
  message: string
  decision: AgentScanDecision | null
  trippedAt: number | null
}

export class AgentCircuitBreakerOpen extends Error {
  readonly state: CircuitBreakerState

  constructor(state: CircuitBreakerState) {
    super(state.message)
    this.name = 'AgentCircuitBreakerOpen'
    this.state = state
  }
}

export class AgentCircuitBreaker {
  private state: CircuitBreakerState = {
    tripped: false,
    reason: null,
    message: '',
    decision: null,
    trippedAt: null,
  }

  private readonly listeners = new Set<(state: CircuitBreakerState) => void>()

  get isTripped(): boolean {
    return this.state.tripped
  }

  get snapshot(): CircuitBreakerState {
    return { ...this.state }
  }

  onTrip(listener: (state: CircuitBreakerState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Trips the breaker. The first reason wins — later trips do not overwrite it. */
  trip(reason: AgentAbortReason, message: string, decision: AgentScanDecision | null = null): void {
    if (this.state.tripped) return

    this.state = { tripped: true, reason, message, decision, trippedAt: Date.now() }
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot)
      } catch (error) {
        console.error('[agent-breaker] Listener threw:', error)
      }
    }
  }

  /**
   * Applies a scan verdict. Returns true when execution may proceed.
   * A missing or failed scan is treated as unsafe, never as permission.
   */
  applyScanDecision(decision: AgentScanDecision | null): boolean {
    // Once tripped, stay tripped. A page that flickers between hostile and
    // clean content must not be able to earn its way back to executing.
    if (this.state.tripped) return false

    if (!decision) {
      this.trip('scan_failed', 'The page could not be security-scanned, so no action was taken.')
      return false
    }

    if (!decision.allowed) {
      this.trip('injection_detected', decision.summary_reason, decision)
      return false
    }

    return true
  }

  /** Throws if execution is not permitted. Call immediately before acting. */
  assertClosed(): void {
    if (this.state.tripped) {
      throw new AgentCircuitBreakerOpen(this.snapshot)
    }
  }
}
