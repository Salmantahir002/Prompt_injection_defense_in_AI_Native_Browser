// Port of backend/app/services/agent_security_event_store.py.
//
// Deliberately a separate store from securityEventStore.ts, which belongs to
// the user-initiated "Scan Page" workflow. The two logs must never interleave:
// a user reading their manual scan history should not see the agent's
// per-iteration scans, and an aborted agent task must be attributable to its
// own task id.
import { randomUUID } from 'node:crypto'

export interface AgentSecurityEvent {
  id: string
  timestamp: string
  task_id: string
  url: string
  allowed: boolean
  risk_level: string
  summary_reason: string
  blocked_sources: string[]
  origin: 'agent_runtime'
}

const MAX_SIZE = 100

class AgentSecurityEventStore {
  private events: AgentSecurityEvent[] = []

  addEvent(
    taskId: string,
    url: string,
    allowed: boolean,
    riskLevel: string,
    summaryReason: string,
    blockedSources: readonly string[] = [],
  ): AgentSecurityEvent {
    const event: AgentSecurityEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      task_id: taskId,
      url,
      allowed,
      risk_level: riskLevel,
      summary_reason: summaryReason,
      blocked_sources: [...blockedSources],
      origin: 'agent_runtime',
    }
    this.events.push(event)
    if (this.events.length > MAX_SIZE) this.events.shift()
    return event
  }

  /** Newest first, optionally narrowed to a single task. */
  getEvents(taskId?: string): AgentSecurityEvent[] {
    const events = [...this.events].reverse()
    return taskId ? events.filter((event) => event.task_id === taskId) : events
  }

  clear(): void {
    this.events = []
  }
}

export const agentSecurityEventStore = new AgentSecurityEventStore()
