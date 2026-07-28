import type { SemanticElement } from '../types/browserRuntimeTypes'

/**
 * Browser Memory — reusable site knowledge that survives a task.
 *
 * What it stores, deliberately narrowly: which (role, name) control the agent
 * successfully used for a given tool on a given origin, and how often. That is
 * enough to help the recovery engine relocate a control and to tell the
 * planner "last time, this worked here".
 *
 * What it does NOT store, and why:
 *
 *  - Page text, headings, or any content the site produced. Memory is written
 *    from pages that passed a security scan, but a scan is a filter, not a
 *    proof. Persisting page-derived prose would create a store of
 *    attacker-influenced text that outlives the scan that cleared it and gets
 *    replayed into future prompts — an injection with a longer half-life than
 *    the page it came from. Only our own structured observations are kept.
 *  - Cookies and authentication state. Those already live in the Electron
 *    session and are managed by Chromium; duplicating them here would add a
 *    second, weaker copy of credentials with no benefit.
 *  - Downloads. Not implemented.
 */

const STORAGE_KEY = 'promptDefense.agent.browserMemory.v1'
const MAX_ORIGINS = 50
const MAX_PATTERNS_PER_ORIGIN = 30

export type InteractionPattern = {
  tool: string
  role: string
  name: string
  successCount: number
  lastUsedAt: number
}

export type OriginMemory = {
  origin: string
  visits: number
  lastVisitedAt: number
  patterns: InteractionPattern[]
  /** Set when a scan blocked this origin; the agent should not trust it. */
  blocked?: boolean
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

type MemoryFile = Record<string, OriginMemory>

function readStore(): MemoryFile {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as MemoryFile) : {}
  } catch {
    return {}
  }
}

function writeStore(store: MemoryFile): void {
  try {
    const origins = Object.values(store)
      .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt)
      .slice(0, MAX_ORIGINS)

    const trimmed: MemoryFile = {}
    for (const entry of origins) trimmed[entry.origin] = entry
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // Storage being unavailable or full must never break a running task.
  }
}

export class AgentBrowserMemory {
  recordVisit(url: string): void {
    const origin = originOf(url)
    if (!origin) return

    const store = readStore()
    const existing = store[origin]
    store[origin] = {
      origin,
      visits: (existing?.visits ?? 0) + 1,
      lastVisitedAt: Date.now(),
      patterns: existing?.patterns ?? [],
      blocked: existing?.blocked,
    }
    writeStore(store)
  }

  /** Records that a tool worked against a particular control on this origin. */
  recordSuccess(url: string, tool: string, element: SemanticElement | undefined): void {
    const origin = originOf(url)
    if (!origin || !element || !element.name) return

    const store = readStore()
    const entry = store[origin] ?? { origin, visits: 1, lastVisitedAt: Date.now(), patterns: [] }
    if (entry.blocked) return

    const existing = entry.patterns.find(
      (pattern) => pattern.tool === tool && pattern.role === element.role && pattern.name === element.name,
    )

    if (existing) {
      existing.successCount += 1
      existing.lastUsedAt = Date.now()
    } else {
      entry.patterns.push({
        tool,
        role: element.role,
        name: element.name,
        successCount: 1,
        lastUsedAt: Date.now(),
      })
    }

    entry.patterns.sort((left, right) => right.successCount - left.successCount || right.lastUsedAt - left.lastUsedAt)
    entry.patterns = entry.patterns.slice(0, MAX_PATTERNS_PER_ORIGIN)
    entry.lastVisitedAt = Date.now()
    store[origin] = entry
    writeStore(store)
  }

  /**
   * Marks an origin as hostile and discards everything learned from it. A site
   * that served an injection should not also get to keep the knowledge the
   * agent accumulated while it was trusted.
   */
  markBlocked(url: string): void {
    const origin = originOf(url)
    if (!origin) return

    const store = readStore()
    store[origin] = {
      origin,
      visits: store[origin]?.visits ?? 1,
      lastVisitedAt: Date.now(),
      patterns: [],
      blocked: true,
    }
    writeStore(store)
  }

  get(url: string): OriginMemory | undefined {
    const origin = originOf(url)
    return origin ? readStore()[origin] : undefined
  }

  isBlocked(url: string): boolean {
    return this.get(url)?.blocked === true
  }

  /** Short hints for the planner prompt; empty for an unknown or blocked site. */
  hintsFor(url: string, limit = 5): string[] {
    const entry = this.get(url)
    if (!entry || entry.blocked) return []

    return entry.patterns
      .slice(0, limit)
      .map((pattern) => `${pattern.tool} on ${pattern.role} "${pattern.name}" worked here before`)
  }

  clear(): void {
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY)
    } catch {
      // ignored
    }
  }
}

export const agentBrowserMemory = new AgentBrowserMemory()
