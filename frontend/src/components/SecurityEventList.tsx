import type { SecurityEvent } from '../types/securityTypes'

type SecurityEventListProps = {
  events: SecurityEvent[]
}

export function SecurityEventList({ events }: SecurityEventListProps) {
  return (
    <section className="security-events" aria-label="Security events">
      <h3>Security Events</h3>
      <div className="security-events__list">
        {events.length === 0 ? (
          <p>No checks yet.</p>
        ) : (
          events.map((event) => (
            <article className="security-event" key={`${event.timestamp}-${event.summary_reason}`}>
              <span>{event.label}</span>
              <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
              <p>{event.summary_reason}</p>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
