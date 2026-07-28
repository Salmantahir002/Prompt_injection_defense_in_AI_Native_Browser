import type { AgentScanDecision } from '../types/agentTypes'
import type { AgentSecuritySnapshot } from '../types/browserRuntimeTypes'
import { invokeRuntime } from './browserRuntime'
import { AgentSecurityCache, hashSnapshot } from './agentSecurityCache'

/**
 * The agent's security pipeline: deep CDP capture → cache lookup → scan.
 *
 * Completely independent of the manual "Scan Page" workflow. It uses its own
 * runtime command, its own backend endpoint (POST /agent/scan-active-page),
 * and its own event log. `POST /security/check-webpage` is never called from
 * here, and must never be.
 */

const AGENT_API_BASE_URL = 'http://127.0.0.1:8000/api/v1'

export class AgentSecurityScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentSecurityScanError'
  }
}

export class AgentSecurityPipeline {
  private readonly cache = new AgentSecurityCache()
  private readonly taskId: string

  constructor(taskId: string) {
    this.taskId = taskId
  }

  /**
   * Produces the verdict for the page currently loaded in `targetId`.
   *
   * Any failure — capture, network, backend — throws rather than returning a
   * permissive result. The circuit breaker treats an absent verdict as unsafe,
   * so a scan that cannot run stops the task instead of waving it through.
   */
  async scanActivePage(targetId: number, signal?: AbortSignal): Promise<AgentScanDecision> {
    const snapshotResult = await invokeRuntime(targetId, 'captureSecuritySnapshot', {})
    if (!snapshotResult.ok) {
      throw new AgentSecurityScanError(`Could not capture the page for scanning: ${snapshotResult.error.message}`)
    }

    const snapshot = snapshotResult.data
    const pageHash = await hashSnapshot(snapshot as unknown as Record<string, unknown>)
    const url = snapshot.url

    const cached = this.cache.get(this.taskId, url, pageHash)
    if (cached) {
      // Identical content at the same url: the earlier verdict still holds.
      return { ...cached, fromCache: true }
    }

    const decision = await this.requestScan(snapshot, url, pageHash, signal)
    this.cache.set(this.taskId, url, pageHash, decision)
    return decision
  }

  private async requestScan(
    snapshot: AgentSecuritySnapshot,
    url: string,
    pageHash: string,
    signal?: AbortSignal,
  ): Promise<AgentScanDecision> {
    let response: Response
    try {
      response = await fetch(`${AGENT_API_BASE_URL}/agent/scan-active-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: this.taskId, url, page_hash: pageHash, snapshot }),
        signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new AgentSecurityScanError('The security backend is not reachable; the agent cannot proceed.')
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AgentSecurityScanError(detail || `Security scan failed with status ${response.status}`)
    }

    return response.json() as Promise<AgentScanDecision>
  }

  endTask(): void {
    this.cache.clearTask(this.taskId)
  }

  get cachedDecisionCount(): number {
    return this.cache.size
  }
}
