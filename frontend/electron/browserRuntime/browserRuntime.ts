import type { CdpSession } from './cdpSession.js'
import { focusElement, resolveElementPoint, readViewportSize } from './elementResolver.js'
import {
  clearFocusedField,
  dispatchNativeClick,
  dispatchNativeKeyPress,
  dispatchNativeScroll,
  dispatchNativeType,
} from './nativeInput.js'
import { capturePageScreenshot, fetchAccessibilityTree } from './pageInspector.js'
import { buildSemanticState } from './stateBuilder.js'
import { settleAfterAction, waitForDomStable, waitForNavigation } from './waitEngine.js'
import {
  moveVirtualCursor,
  parkVirtualCursor,
  pulseVirtualCursorClick,
  pulseVirtualCursorScroll,
  pulseVirtualCursorTyping,
  setAgentOverlayActive,
} from './virtualCursor.js'
import { captureActionSignature, verifyAction, type ActionSignature } from './verificationEngine.js'
import {
  BrowserRuntimeError,
  toRuntimeFailure,
  type ActionAck,
  type ActionVerification,
  type VerificationExpectation,
  type AgentSecuritySnapshot,
  type ClickParams,
  type ElementHandle,
  type FillParams,
  type NavigateParams,
  type NavigationResult,
  type PageStateSnapshot,
  type PressKeyParams,
  type RuntimeCommandName,
  type RuntimeCommandResult,
  type RuntimeParams,
  type RuntimeResult,
  type ScreenshotParams,
  type ScreenshotResult,
  type OverlayParams,
  type ScrollParams,
  type TargetDescriptor,
  type TypeParams,
  type UploadParams,
  type WaitParams,
} from './runtimeContract.js'

/**
 * Domains the agent needs. `Input` has no enable command — its events are
 * dispatched directly.
 */
const AGENT_CDP_DOMAINS = ['Page', 'DOM', 'Runtime', 'Accessibility'] as const

/** Only ordinary web navigation is permitted; `javascript:`, `file:`, and `data:` are not. */
const ALLOWED_NAVIGATION_SCHEMES = new Set(['http:', 'https:', 'about:'])

const DEFAULT_SCROLL_DELTA = 400

/**
 * The single gateway through which every agent-driven browser action passes.
 *
 * Design constraints this class exists to enforce:
 *  - No agent action may reach the page except through `invoke()`, so later
 *    phases can gate, verify, and recover from actions in one place.
 *  - The runtime is independent of the LLM: it knows nothing about planners,
 *    goals, or prompts.
 *  - Interaction happens over CDP native input, never by injecting scripts.
 *
 * Phases 1–3 implement the lifecycle, the inspection layer, and the action
 * layer. File upload is deliberately withheld until the Phase 7 approval
 * workflow exists.
 */
/**
 * Supplies the deep page capture the agent's security scan consumes. Injected
 * so the runtime stays unaware of who implements the capture, and so the agent
 * path never calls the manual scanner's IPC channel.
 */
export type DeepContentProvider = (targetId: number) => Promise<Record<string, unknown> | null>

/**
 * Opens a native file picker and returns what the user chose. Returning an
 * empty array means they cancelled, which the runtime treats as refusal.
 */
export type FilePickerProvider = () => Promise<string[]>

const SNAPSHOT_FIELDS: readonly (keyof AgentSecuritySnapshot)[] = [
  'visible_text', 'hidden_text', 'html_comments', 'meta_tags', 'input_values', 'aria_text',
  'iframe_content', 'shadow_dom_content', 'inline_javascript', 'external_javascript', 'css_content',
  'css_generated_content', 'network_responses', 'websocket_messages', 'service_worker_activity',
  'dom_snapshot_content', 'page_title', 'url',
]

export class BrowserRuntime {
  private readonly targets = new Map<number, CdpSession>()
  /** Latest element id → node binding per target, refreshed by extractPageState. */
  private readonly elementHandles = new Map<number, Map<string, ElementHandle>>()
  private actionCounter = 0

  constructor(
    private readonly deepContentProvider?: DeepContentProvider,
    private readonly filePickerProvider?: FilePickerProvider,
  ) {}

  /**
   * Marks a guest webview as drivable by the agent. Only registered targets
   * can be addressed over IPC, so a compromised renderer cannot point the
   * runtime at arbitrary webContents.
   */
  registerTarget(session: CdpSession): void {
    this.targets.set(session.targetId, session)
    void session.enableDomains(AGENT_CDP_DOMAINS).catch((error) => {
      console.warn(`[browser-runtime] Domain setup failed for target ${session.targetId}:`, error)
    })
  }

  unregisterTarget(targetId: number): void {
    this.targets.delete(targetId)
    this.elementHandles.delete(targetId)
  }

  isRegistered(targetId: number): boolean {
    return this.targets.get(targetId)?.isAlive() ?? false
  }

  listTargets(): number[] {
    return [...this.targets.values()].filter((session) => session.isAlive()).map((session) => session.targetId)
  }

  /**
   * Resolves a planner-visible element id back to its accessibility/DOM node.
   * Returns undefined when no state has been extracted yet or the id is stale.
   */
  resolveElement(targetId: number, elementId: string): ElementHandle | undefined {
    return this.elementHandles.get(targetId)?.get(elementId)
  }

  async invoke<K extends RuntimeCommandName>(
    targetId: number,
    name: K,
    params: RuntimeParams<K>,
  ): Promise<RuntimeResult<RuntimeCommandResult<K>>> {
    try {
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        throw new BrowserRuntimeError('INVALID_ARGUMENT', `Command ${name} expects an object of parameters`)
      }

      const session = this.requireSession(targetId)
      const data = await this.dispatch(session, name, params)
      return { ok: true, data: data as RuntimeCommandResult<K> }
    } catch (error) {
      return { ok: false, error: toRuntimeFailure(error) }
    }
  }

  private requireSession(targetId: number): CdpSession {
    const session = this.targets.get(targetId)
    if (!session) {
      throw new BrowserRuntimeError('NO_TARGET', `Target ${targetId} is not registered with the browser runtime`)
    }
    if (!session.isAlive()) {
      this.targets.delete(targetId)
      this.elementHandles.delete(targetId)
      throw new BrowserRuntimeError('TARGET_DETACHED', `Target ${targetId} lost its CDP session`)
    }

    return session
  }

  /**
   * Element ids only survive until the next `extractPageState`. A miss means
   * the page moved on, which Phase 6 recovery answers by rebuilding state.
   */
  private requireHandle(session: CdpSession, elementId: unknown): ElementHandle {
    if (typeof elementId !== 'string' || !elementId) {
      throw new BrowserRuntimeError('INVALID_ARGUMENT', 'An element id is required')
    }

    const handle = this.elementHandles.get(session.targetId)?.get(elementId)
    if (!handle) {
      throw new BrowserRuntimeError(
        'ELEMENT_NOT_FOUND',
        `Element ${elementId} is unknown or stale; extract page state again`,
      )
    }

    return handle
  }

  private dispatch(session: CdpSession, name: RuntimeCommandName, params: object): Promise<unknown> {
    switch (name) {
      case 'describeTarget':
        return this.describeTarget(session)
      case 'extractPageState':
        return this.extractPageState(session)
      case 'captureScreenshot':
        return this.captureScreenshot(session, params as ScreenshotParams)
      case 'captureSecuritySnapshot':
        return this.captureSecuritySnapshot(session)
      case 'navigate':
        return this.navigate(session, params as NavigateParams)
      case 'click':
        return this.click(session, params as ClickParams)
      case 'fill':
        return this.fill(session, params as FillParams)
      case 'type':
        return this.type(session, params as TypeParams)
      case 'pressKey':
        return this.pressKey(session, params as PressKeyParams)
      case 'scroll':
        return this.scroll(session, params as ScrollParams)
      case 'upload':
        return this.upload(session, params as UploadParams)
      case 'waitForNavigation':
        return this.waitForNavigation(session, params as WaitParams)
      case 'waitForDomStable':
        return this.waitForDomStable(session, params as WaitParams)
      case 'setAgentOverlay':
        return this.setAgentOverlay(session, params as OverlayParams)
      default:
        return Promise.reject(new BrowserRuntimeError('INVALID_ARGUMENT', `Unknown runtime command: ${String(name)}`))
    }
  }

  private async describeTarget(session: CdpSession): Promise<TargetDescriptor> {
    return {
      targetId: session.targetId,
      url: session.url(),
      title: session.title(),
      attached: session.isAlive(),
    }
  }

  /**
   * Rebuilds the semantic view of the page and re-binds element ids. Element
   * ids are only valid until the next extraction, so this call and the actions
   * that follow it must stay within one planning cycle.
   */
  private async extractPageState(session: CdpSession): Promise<PageStateSnapshot> {
    const nodes = await fetchAccessibilityTree(session)
    const { state, handles } = buildSemanticState({
      targetId: session.targetId,
      url: session.url(),
      title: session.title(),
      nodes,
      capturedAt: Date.now(),
    })

    this.elementHandles.set(session.targetId, new Map(handles.map((handle) => [handle.elementId, handle])))
    return state
  }

  private captureScreenshot(session: CdpSession, params: ScreenshotParams): Promise<ScreenshotResult> {
    return capturePageScreenshot(session, params)
  }

  /**
   * Deep content capture for the agent's own security scan.
   *
   * Kept as a runtime command so that everything the agent does to a page —
   * including observing it for threats — flows through the one gateway. The
   * manual "Scan Page" IPC channel is never involved.
   */
  private async captureSecuritySnapshot(session: CdpSession): Promise<AgentSecuritySnapshot> {
    if (!this.deepContentProvider) {
      throw new BrowserRuntimeError('NOT_IMPLEMENTED', 'No deep content provider is configured for the browser runtime')
    }

    const captured = await this.deepContentProvider(session.targetId)
    if (!captured) {
      // An empty capture must never be mistaken for a clean page.
      throw new BrowserRuntimeError('CDP_ERROR', `Deep content capture failed for target ${session.targetId}`)
    }

    const snapshot = {} as AgentSecuritySnapshot
    for (const field of SNAPSHOT_FIELDS) {
      const value = captured[field]
      snapshot[field] = typeof value === 'string' ? value : ''
    }
    if (!snapshot.url) snapshot.url = session.url()
    if (!snapshot.page_title) snapshot.page_title = session.title()

    return snapshot
  }

  private async navigate(session: CdpSession, params: NavigateParams): Promise<NavigationResult> {
    const url = this.validateNavigationUrl(params.url)
    const before = await captureActionSignature(session)

    // Arm the wait before navigating so a fast load cannot land first.
    const navigationSettled = waitForNavigation(session, { timeoutMs: params.timeoutMs })
    await session.send('Page.navigate', { url })
    await navigationSettled

    // Any element id from the previous page is meaningless now.
    this.elementHandles.delete(session.targetId)

    const after = await captureActionSignature(session)
    return {
      ...this.ack(verifyAction(before, after, { expectation: 'url' })),
      url: session.url(),
    }
  }

  private validateNavigationUrl(candidate: unknown): string {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      throw new BrowserRuntimeError('INVALID_ARGUMENT', 'A navigation url is required')
    }

    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      throw new BrowserRuntimeError('NAVIGATION_BLOCKED', `Not a valid absolute url: ${candidate}`)
    }

    if (!ALLOWED_NAVIGATION_SCHEMES.has(parsed.protocol)) {
      throw new BrowserRuntimeError('NAVIGATION_BLOCKED', `Navigation scheme ${parsed.protocol} is not permitted`)
    }

    return parsed.toString()
  }

  /**
   * Runs an action between a before/after signature so the caller learns
   * whether it actually took effect, not merely that it was dispatched.
   */
  private async withVerification(
    session: CdpSession,
    expectation: VerificationExpectation,
    action: () => Promise<void>,
    options: { backendNodeId?: number; expectedValue?: string } = {},
  ): Promise<ActionAck> {
    const before: ActionSignature = expectation === 'none'
      ? { url: '', structureHash: '', scrollY: 0, targetValue: null, targetChecked: null }
      : await captureActionSignature(session, options.backendNodeId)

    await action()
    // The settled tree is reused as the "after" snapshot rather than fetched
    // again, which removes one full accessibility-tree round trip per action.
    const settledNodes = await settleAfterAction(session)

    if (expectation === 'none') return this.ack()

    const after = await captureActionSignature(session, options.backendNodeId, settledNodes)
    return this.ack(verifyAction(before, after, { expectation, expectedValue: options.expectedValue }))
  }

  private async click(session: CdpSession, params: ClickParams): Promise<ActionAck> {
    const handle = this.requireHandle(session, params.elementId)
    const point = await resolveElementPoint(session, handle)
    await moveVirtualCursor(session, point, handle.name || 'click')

    // A click that hits an overlay dispatches fine but changes nothing, so
    // "something changed" is the weakest honest expectation we can assert.
    return this.withVerification(
      session,
      'change',
      async () => {
        await pulseVirtualCursorClick(session, point)
        await dispatchNativeClick(session, point, { button: params.button, clickCount: params.clickCount })
      },
      { backendNodeId: handle.backendNodeId },
    )
  }

  /**
   * Focuses the field, clears it with a real select-all + delete, then types.
   * The existing value is never assigned or read back through script.
   */
  private async fill(session: CdpSession, params: FillParams): Promise<ActionAck> {
    if (typeof params.value !== 'string') {
      throw new BrowserRuntimeError('INVALID_ARGUMENT', 'fill requires a string value')
    }

    const handle = this.requireHandle(session, params.elementId)
    // Clicking focuses the way a user would, which also opens comboboxes and
    // date pickers that only react to pointer input.
    const point = await resolveElementPoint(session, handle)
    await moveVirtualCursor(session, point, handle.name || 'fill')

    return this.withVerification(
      session,
      'value',
      async () => {
        await pulseVirtualCursorClick(session, point)
        await dispatchNativeClick(session, point)
        await focusElement(session, handle).catch(() => undefined)
        await clearFocusedField(session)
        await pulseVirtualCursorTyping(session, `type "${params.value.slice(0, 40)}"`)
        await dispatchNativeType(session, params.value, params.delayMs ?? 0)
      },
      { backendNodeId: handle.backendNodeId, expectedValue: params.value },
    )
  }

  private async type(session: CdpSession, params: TypeParams): Promise<ActionAck> {
    if (typeof params.text !== 'string') {
      throw new BrowserRuntimeError('INVALID_ARGUMENT', 'type requires a string text')
    }

    return this.withVerification(
      session,
      'change',
      async () => {
        await pulseVirtualCursorTyping(session, `type "${params.text.slice(0, 40)}"`)
        await dispatchNativeType(session, params.text, params.delayMs ?? 0)
      },
    )
  }

  private async pressKey(session: CdpSession, params: PressKeyParams): Promise<ActionAck> {
    if (typeof params.key !== 'string' || !params.key) {
      throw new BrowserRuntimeError('INVALID_ARGUMENT', 'pressKey requires a key name')
    }

    return this.withVerification(
      session,
      'change',
      async () => {
        await pulseVirtualCursorTyping(session, params.key)
        await dispatchNativeKeyPress(session, params.key, params.modifiers ?? 0)
      },
    )
  }

  /**
   * Scrolls with a real wheel event. Without an element the wheel is aimed at
   * the viewport centre, which scrolls whatever container is under it — the
   * same behaviour a user gets.
   */
  private async scroll(session: CdpSession, params: ScrollParams): Promise<ActionAck> {
    const point = params.elementId
      ? await resolveElementPoint(session, this.requireHandle(session, params.elementId))
      : await this.viewportCentre(session)

    const deltaX = typeof params.deltaX === 'number' ? params.deltaX : 0
    const deltaY = typeof params.deltaY === 'number' ? params.deltaY : (params.deltaX ? 0 : DEFAULT_SCROLL_DELTA)

    // Scrolling usually leaves the accessibility tree untouched, so the
    // viewport offset is the signal that matters here.
    return this.withVerification(session, 'scroll', async () => {
      await pulseVirtualCursorScroll(session, point, deltaY)
      await dispatchNativeScroll(session, point, deltaX, deltaY)
    })
  }

  /**
   * Switches the cosmetic agent overlay on or off. Kept as a runtime command so
   * the renderer can light the page up for the duration of a task without ever
   * touching the guest webview itself, and so failures degrade to "no overlay"
   * rather than a failed task.
   */
  private async setAgentOverlay(session: CdpSession, params: OverlayParams): Promise<ActionAck> {
    const active = params.active === true
    await setAgentOverlayActive(session, active)

    // Park the cursor mid-viewport so the first real move glides from
    // somewhere sensible instead of materialising on the target.
    if (active) {
      const centre = await this.viewportCentre(session).catch(() => null)
      if (centre) await parkVirtualCursor(session, centre)
    }

    return this.ack()
  }

  private async viewportCentre(session: CdpSession) {
    const { width, height } = await readViewportSize(session)
    if (width === 0 || height === 0) {
      throw new BrowserRuntimeError('CDP_ERROR', 'Could not read the viewport size')
    }

    return { x: width / 2, y: height / 2 }
  }

  /**
   * Attaches files to a file input.
   *
   * `DOM.setFileInputFiles` can hand any readable file on the machine to a
   * remote site, which is exactly what an indirect prompt injection would aim
   * for. The defence is structural rather than a permission prompt: the file
   * paths are never supplied by the planner. They come from a native OS picker
   * the user operates, so the worst a fully compromised planner can do is ask
   * for a file dialog the user can cancel.
   */
  private async upload(session: CdpSession, params: UploadParams): Promise<ActionAck> {
    const handle = this.requireHandle(session, params.elementId)
    if (!this.filePickerProvider) {
      throw new BrowserRuntimeError('APPROVAL_REQUIRED', 'No file picker is available to confirm this upload')
    }
    if (typeof handle.backendNodeId !== 'number') {
      throw new BrowserRuntimeError('ELEMENT_NOT_INTERACTABLE', `Element ${handle.elementId} is not a file input`)
    }

    const files = await this.filePickerProvider()
    if (!files.length) {
      throw new BrowserRuntimeError('APPROVAL_REQUIRED', 'The upload was cancelled; no files were selected')
    }

    await session.send('DOM.setFileInputFiles', { files, backendNodeId: handle.backendNodeId })
    await settleAfterAction(session)

    return this.ack({
      verified: true,
      urlChanged: false,
      structureChanged: false,
      scrollChanged: false,
      valueChanged: true,
      checkedChanged: false,
      expectation: 'none',
      reason: `Attached ${files.length} file(s) chosen by the user`,
    })
  }

  private async waitForNavigation(session: CdpSession, params: WaitParams): Promise<ActionAck> {
    await waitForNavigation(session, params)
    this.elementHandles.delete(session.targetId)
    return this.ack()
  }

  private async waitForDomStable(session: CdpSession, params: WaitParams): Promise<ActionAck> {
    await waitForDomStable(session, params)
    return this.ack()
  }

  private ack(verification?: ActionVerification): ActionAck {
    this.actionCounter += 1
    return { actionId: `act_${this.actionCounter}`, completedAt: Date.now(), verification }
  }
}
