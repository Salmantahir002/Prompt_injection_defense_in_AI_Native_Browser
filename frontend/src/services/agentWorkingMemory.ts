import type {
  AgentFailureRecord,
  AgentStepRecord,
  AgentWorkingMemorySnapshot,
} from '../types/agentTypes'

/**
 * Working Memory for one agent task.
 *
 * The planner is stateless; this is what carries continuity between planning
 * cycles. It holds a bounded, structured summary — goal, what has been done,
 * what is still outstanding, what failed — rather than a conversation
 * transcript. That keeps each prompt small and, importantly, stops content
 * from previously visited pages accumulating in the planner's context where a
 * stale injection attempt could still influence it.
 */

const MAX_COMPLETED_STEPS = 40
const MAX_FAILURES = 20

export class AgentWorkingMemory {
  readonly goal: string

  private completedSteps: AgentStepRecord[] = []
  private pendingSteps: string[] = []
  private failures: AgentFailureRecord[] = []
  private retries = 0
  private currentPage = ''
  private extractedKnowledge: string[] = []
  private invalidElements = new Set<string>()
  private lastThought = ''

  constructor(goal: string) {
    this.goal = goal.trim()
  }

  recordStep(tool: string, summary: string, succeeded = true): void {
    this.completedSteps.push({ tool, summary, succeeded })
    if (this.completedSteps.length > MAX_COMPLETED_STEPS) {
      // Drop the oldest: recent history is what informs the next action.
      this.completedSteps = this.completedSteps.slice(-MAX_COMPLETED_STEPS)
    }
  }

  recordFailure(tool: string, reason: string, code?: string): void {
    this.failures.push({ tool, reason, code })
    if (this.failures.length > MAX_FAILURES) {
      this.failures = this.failures.slice(-MAX_FAILURES)
    }
  }

  recordFinding(note: string): void {
    const trimmed = (note ?? '').trim()
    if (trimmed && !this.extractedKnowledge.includes(trimmed)) {
      this.extractedKnowledge.push(trimmed)
      if (this.extractedKnowledge.length > 20) {
        this.extractedKnowledge = this.extractedKnowledge.slice(-20)
      }
    }
  }

  recordInvalidElement(elementId: string): void {
    if (elementId && typeof elementId === 'string') {
      this.invalidElements.add(elementId.trim())
    }
  }

  isElementInvalid(elementId: string): boolean {
    return Boolean(elementId && this.invalidElements.has(elementId.trim()))
  }

  setLastThought(thought: string): void {
    this.lastThought = (thought ?? '').trim().slice(0, 500)
  }

  get findings(): readonly string[] {
    return this.extractedKnowledge
  }

  setPendingSteps(steps: string[]): void {
    this.pendingSteps = [...steps]
  }

  /** Retries are counted per task, and cleared once an action lands. */
  incrementRetries(): number {
    this.retries += 1
    return this.retries
  }

  resetRetries(): void {
    this.retries = 0
  }

  get retryCount(): number {
    return this.retries
  }

  /** Navigating away invalidates outstanding retry state and invalid element IDs for the old page. */
  setCurrentPage(url: string): void {
    if (url !== this.currentPage) {
      this.currentPage = url
      this.retries = 0
      this.invalidElements.clear()
    }
  }

  get page(): string {
    return this.currentPage
  }

  get failureCount(): number {
    return this.failures.length
  }

  /** The serialisable form sent to the planner. */
  snapshot(): AgentWorkingMemorySnapshot {
    return {
      goal: this.goal,
      completed_steps: [...this.completedSteps],
      pending_steps: [...this.pendingSteps],
      failures: [...this.failures],
      retries: this.retries,
      current_page: this.currentPage,
      extracted_knowledge: [...this.extractedKnowledge],
      invalid_elements: Array.from(this.invalidElements),
      last_thought: this.lastThought || undefined,
    }
  }
}
