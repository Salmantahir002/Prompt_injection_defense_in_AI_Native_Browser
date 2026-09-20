import type { AgentScanDecision } from '../types/agentTypes'
import type { AgentSecuritySnapshot } from '../types/browserRuntimeTypes'
import { invokeRuntime } from './browserRuntime'
import { AgentSecurityCache, hashSnapshot, normalizeUrl } from './agentSecurityCache'

/**
 * The agent's security pipeline: deep CDP capture → cache lookup → scan.
 *
 * Completely independent of the manual "Scan Page" workflow. It uses its own
 * runtime command, its own backend endpoint (POST /agent/scan-active-page),
 * and its own event log. `POST /security/check-webpage` is never called from
 * here, and must never be.
 *
 * Performance: the DL model (Prompt Guard 2, fp32) is expensive on CPU. To
 * keep the agent loop responsive, scans are skipped when the agent is still on
 * the same page it already scanned. A new full scan runs only when the URL
 * changes (navigation) or when the caller explicitly forces one.
 */

const AGENT_API_BASE_URL = 'http://127.0.0.1:8000/api/v1'

/**
 * Timeout for a single scan request. A large e-commerce page (e.g. Daraz)
 * with 14 content channels can produce 40+ text chunks, each needing DL
 * inference on CPU. 30 s is generous enough for even the heaviest pages
 * while still preventing indefinite hangs from a stuck ONNX runtime.
 */
const SCAN_TIMEOUT_MS = 30_000

export class AgentSecurityScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentSecurityScanError'
  }
}

export class AgentSecurityPipeline {
  private readonly cache = new AgentSecurityCache()
  private readonly taskId: string

  /**
   * URL-level fast path: the last URL that was fully scanned and allowed.
   * When the agent stays on the same page between iterations (click, fill,
   * type, press_key), we reuse this verdict instead of re-running the full
   * DL inference pipeline. This is safe because prompt injections are
   * embedded in the page the agent *navigates to* — the agent's own DOM
   * mutations cannot introduce new injections.
   */
  private lastScannedUrl: string | null = null
  private lastAllowedDecision: AgentScanDecision | null = null

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
    const url = snapshot.url

    // ── URL fast path ──────────────────────────────────────────────────
    // If the agent is still on the same page it already scanned and the
    // previous verdict was "allowed", return immediately. This eliminates
    // the SHA-256 hash, the HTTP round trip, and the DL inference for
    // every same-page iteration (click, fill, type, press_key).
    const normalizedUrl = normalizeUrl(url)
    if (
      this.lastScannedUrl === normalizedUrl &&
      this.lastAllowedDecision !== null
    ) {
      return { ...this.lastAllowedDecision, fromCache: true }
    }

    // ── Full scan path (new URL or first iteration) ────────────────────
    const pageHash = await hashSnapshot(snapshot as unknown as Record<string, unknown>)

    const cached = this.cache.get(this.taskId, url, pageHash)
    if (cached) {
      // Identical content at the same url: the earlier verdict still holds.
      this.lastScannedUrl = normalizedUrl
      this.lastAllowedDecision = cached
      return { ...cached, fromCache: true }
    }

    const decision = await this.requestScanWithTimeout(snapshot, url, pageHash, signal)
    this.cache.set(this.taskId, url, pageHash, decision)

    // Update the URL fast-path only for allowed verdicts. A blocked page
    // ends the task outright, so there is no future iteration to skip.
    if (decision.allowed) {
      this.lastScannedUrl = normalizedUrl
      this.lastAllowedDecision = decision
    }

    return decision
  }

  /**
   * Clears the URL fast-path cache, forcing the next `scanActivePage` call
   * to perform a full scan. Called by the runtime after navigation or
   * open_tab so the new page is always scanned.
   */
  invalidateUrlCache(): void {
    this.lastScannedUrl = null
    this.lastAllowedDecision = null
  }

  /**
   * Wraps `requestScan` with a timeout so a hung DL inference or an
   * unresponsive backend cannot stall the agent loop indefinitely.
   */
  private async requestScanWithTimeout(
    snapshot: AgentSecuritySnapshot,
    url: string,
    pageHash: string,
    signal?: AbortSignal,
  ): Promise<AgentScanDecision> {
    const controller = new AbortController()

    // Merge the caller's signal with our timeout signal.
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)

    try {
      return await this.requestScan(snapshot, url, pageHash, controller.signal)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Was it the caller's signal or our timeout?
        if (signal?.aborted) throw error
        throw new AgentSecurityScanError(
          `Security scan timed out after ${SCAN_TIMEOUT_MS / 1000}s — the DL model may be overloaded. ` +
          'The agent cannot proceed without a security verdict.',
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
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
    this.lastScannedUrl = null
    this.lastAllowedDecision = null
  }

  get cachedDecisionCount(): number {
    return this.cache.size
  }
}
