/**
 * Renderer-side mirror of `electron/browserRuntime/runtimeContract.ts`.
 *
 * The two TypeScript projects (`tsconfig.app.json` covers `src` only) cannot
 * import across the process boundary, so these type declarations are kept in
 * sync by hand. Change one, change the other.
 */

export type BrowserRuntimeErrorCode =
  | 'RUNTIME_UNAVAILABLE'
  | 'NO_TARGET'
  | 'TARGET_DETACHED'
  | 'INVALID_ARGUMENT'
  | 'CDP_ERROR'
  | 'TIMEOUT'
  | 'NOT_IMPLEMENTED'
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_NOT_INTERACTABLE'
  | 'NAVIGATION_BLOCKED'
  | 'APPROVAL_REQUIRED'

export type RuntimeFailure = { code: BrowserRuntimeErrorCode; message: string }

export type RuntimeResult<T> = { ok: true; data: T } | { ok: false; error: RuntimeFailure }

export type TargetDescriptor = {
  targetId: number
  url: string
  title: string
  attached: boolean
}

export type VerificationExpectation = 'url' | 'value' | 'scroll' | 'change' | 'none'

/** Evidence that an action actually took effect. */
export type ActionVerification = {
  verified: boolean
  urlChanged: boolean
  structureChanged: boolean
  scrollChanged: boolean
  valueChanged: boolean
  expectation: VerificationExpectation
  reason: string
}

export type ActionAck = {
  actionId: string
  completedAt: number
  verification?: ActionVerification
}

export type NavigationResult = ActionAck & { url: string }

export type ScreenshotResult = {
  format: 'png'
  dataBase64: string
  capturedAt: number
}

export type CheckedState = 'true' | 'false' | 'mixed'

export type SemanticElement = {
  id: string
  role: string
  name: string
  value?: string
  description?: string
  url?: string
  disabled?: boolean
  required?: boolean
  focused?: boolean
  expanded?: boolean
  selected?: boolean
  checked?: CheckedState
  invalid?: string
}

export type SemanticDialog = {
  id: string
  role: string
  name: string
  modal: boolean
}

export type ValidationIssue = {
  elementId: string
  role: string
  message: string
}

/** Compact, planner-facing view of a page. The raw AXTree never reaches here. */
export type PageStateSnapshot = {
  targetId: number
  url: string
  title: string
  capturedAt: number
  elements: SemanticElement[]
  focusedElementId: string | null
  dialogs: SemanticDialog[]
  validationErrors: ValidationIssue[]
  selectedElementIds: string[]
  truncated: boolean
}

/** Deep content capture consumed only by the agent's security scan. */
export type AgentSecuritySnapshot = {
  visible_text: string
  hidden_text: string
  html_comments: string
  meta_tags: string
  input_values: string
  aria_text: string
  iframe_content: string
  shadow_dom_content: string
  inline_javascript: string
  external_javascript: string
  css_content: string
  css_generated_content: string
  network_responses: string
  websocket_messages: string
  service_worker_activity: string
  dom_snapshot_content: string
  page_title: string
  url: string
}

export type NavigateParams = { url: string; timeoutMs?: number }
export type ClickParams = { elementId: string; button?: 'left' | 'right' | 'middle'; clickCount?: number }
export type FillParams = { elementId: string; value: string; delayMs?: number }
export type TypeParams = { text: string; delayMs?: number }
export type PressKeyParams = { key: string; modifiers?: number }
export type ScrollParams = { deltaX?: number; deltaY?: number; elementId?: string }
export type UploadParams = { elementId: string; filePaths: string[] }
export type WaitParams = { timeoutMs?: number; quietPeriodMs?: number }
export type ScreenshotParams = { fullPage?: boolean }
/** Toggles the cosmetic agent overlay (virtual cursor + breathing glow). */
export type OverlayParams = { active: boolean }
export type EmptyParams = Record<string, never>

export type RuntimeCommandMap = {
  describeTarget: { params: EmptyParams; result: TargetDescriptor }
  navigate: { params: NavigateParams; result: NavigationResult }
  click: { params: ClickParams; result: ActionAck }
  fill: { params: FillParams; result: ActionAck }
  type: { params: TypeParams; result: ActionAck }
  pressKey: { params: PressKeyParams; result: ActionAck }
  scroll: { params: ScrollParams; result: ActionAck }
  upload: { params: UploadParams; result: ActionAck }
  waitForNavigation: { params: WaitParams; result: ActionAck }
  waitForDomStable: { params: WaitParams; result: ActionAck }
  captureScreenshot: { params: ScreenshotParams; result: ScreenshotResult }
  extractPageState: { params: EmptyParams; result: PageStateSnapshot }
  captureSecuritySnapshot: { params: EmptyParams; result: AgentSecuritySnapshot }
  setAgentOverlay: { params: OverlayParams; result: ActionAck }
}

export type RuntimeCommandName = keyof RuntimeCommandMap
export type RuntimeParams<K extends RuntimeCommandName> = RuntimeCommandMap[K]['params']
export type RuntimeCommandResult<K extends RuntimeCommandName> = RuntimeCommandMap[K]['result']
