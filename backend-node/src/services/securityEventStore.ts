import { randomUUID } from 'node:crypto'

export interface SecurityEvent {
  id: string
  timestamp: string
  allowed: boolean
  label: string
  source: string
  summary_reason: string
}

const MAX_SIZE = 50

class SecurityEventStore {
  private events: SecurityEvent[] = []

  addEvent(allowed: boolean, label: string, source: string, summaryReason: string): SecurityEvent {
    const event: SecurityEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      allowed,
      label,
      source,
      summary_reason: summaryReason,
    }
    this.events.push(event)
    if (this.events.length > MAX_SIZE) {
      this.events.shift()
    }
    return event
  }

  getEvents(): SecurityEvent[] {
    return [...this.events].reverse()
  }
}

export const securityEventStore = new SecurityEventStore()
