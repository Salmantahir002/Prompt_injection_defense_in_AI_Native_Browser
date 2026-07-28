import type { AXNode, AXProperty } from './pageInspector.js'
import type {
  CheckedState,
  ElementHandle,
  PageStateSnapshot,
  SemanticDialog,
  SemanticElement,
  ValidationIssue,
} from './runtimeContract.js'

/**
 * Converts a raw accessibility tree into the compact semantic state the
 * planner reasons over.
 *
 * This module is deliberately pure: no CDP session, no I/O, no clock beyond
 * the caller-supplied timestamp. That keeps the AXTree → state mapping — the
 * part most likely to need tuning as real sites are exercised — independently
 * inspectable and testable.
 */

/** Roles the agent can act on. Everything else is decorative for our purposes. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
])

const DIALOG_ROLES = new Set(['dialog', 'alertdialog'])
const ALERT_ROLES = new Set(['alert', 'alertdialog', 'status'])

const MAX_ELEMENTS = 150
const MAX_DIALOGS = 10
const MAX_VALIDATION_ISSUES = 20
const MAX_NAME_LENGTH = 160
const MAX_VALUE_LENGTH = 240

export type StateBuilderInput = {
  targetId: number
  url: string
  title: string
  nodes: AXNode[]
  capturedAt: number
}

export type BuiltState = {
  state: PageStateSnapshot
  handles: ElementHandle[]
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function normalizeText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return clip(value.replace(/\s+/g, ' ').trim(), limit)
}

function propertyMap(node: AXNode): Map<string, unknown> {
  const properties: AXProperty[] = Array.isArray(node.properties) ? node.properties : []
  const map = new Map<string, unknown>()
  for (const property of properties) {
    if (typeof property?.name === 'string') {
      map.set(property.name, property.value?.value)
    }
  }

  return map
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true'
}

function asCheckedState(value: unknown): CheckedState | undefined {
  return value === 'true' || value === 'false' || value === 'mixed' ? value : undefined
}

/** An `invalid` of anything other than "false" means the field is in error. */
function invalidReason(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === 'false' || !value) return undefined
  return value
}

/**
 * A node earns a planner-visible id if the agent might act on it, if it is a
 * dialog the agent must notice, or if it is an alert carrying a validation
 * message. Everything else is dropped.
 */
function isExposed(role: string, properties: Map<string, unknown>): boolean {
  if (INTERACTIVE_ROLES.has(role) || DIALOG_ROLES.has(role) || ALERT_ROLES.has(role)) return true
  // Editable non-textbox containers (contenteditable divs) still accept input.
  return asBoolean(properties.get('editable'))
}

export function buildSemanticState(input: StateBuilderInput): BuiltState {
  const elements: SemanticElement[] = []
  const dialogs: SemanticDialog[] = []
  const validationErrors: ValidationIssue[] = []
  const selectedElementIds: string[] = []
  const handles: ElementHandle[] = []

  let focusedElementId: string | null = null
  let idCounter = 0
  let truncated = false

  for (const node of input.nodes) {
    if (node.ignored === true || typeof node.nodeId !== 'string') continue

    const role = typeof node.role?.value === 'string' ? node.role.value : ''
    if (!role) continue

    const properties = propertyMap(node)
    if (asBoolean(properties.get('hidden'))) continue
    if (!isExposed(role, properties)) continue

    const isInteractive = INTERACTIVE_ROLES.has(role) || asBoolean(properties.get('editable'))
    const isDialog = DIALOG_ROLES.has(role)
    const isAlert = ALERT_ROLES.has(role)
    const invalid = invalidReason(properties.get('invalid'))

    if (isInteractive && elements.length >= MAX_ELEMENTS) {
      truncated = true
      continue
    }

    const name = normalizeText(node.name?.value, MAX_NAME_LENGTH)
    const description = normalizeText(node.description?.value, MAX_NAME_LENGTH)
    const value = normalizeText(node.value?.value, MAX_VALUE_LENGTH)

    // An unnamed, valueless control is not addressable by the planner and only
    // costs context, so it is skipped unless it carries an error.
    if (isInteractive && !name && !value && !description && !invalid) continue

    idCounter += 1
    const elementId = `e${idCounter}`
    handles.push({
      elementId,
      axNodeId: node.nodeId,
      backendNodeId: typeof node.backendDOMNodeId === 'number' ? node.backendDOMNodeId : undefined,
      role,
      name,
    })

    const focused = asBoolean(properties.get('focused'))
    if (focused && !focusedElementId) focusedElementId = elementId

    if (isInteractive) {
      const selected = asBoolean(properties.get('selected'))
      if (selected) selectedElementIds.push(elementId)

      const element: SemanticElement = { id: elementId, role, name }
      if (value) element.value = value
      if (description && description !== name) element.description = description
      const url = normalizeText(properties.get('url'), MAX_NAME_LENGTH)
      if (url) element.url = url
      if (asBoolean(properties.get('disabled'))) element.disabled = true
      if (asBoolean(properties.get('required'))) element.required = true
      if (focused) element.focused = true
      if (properties.has('expanded')) element.expanded = asBoolean(properties.get('expanded'))
      if (selected) element.selected = true
      const checked = asCheckedState(properties.get('checked'))
      if (checked) element.checked = checked
      if (invalid) element.invalid = invalid

      elements.push(element)
    }

    if (isDialog && dialogs.length < MAX_DIALOGS) {
      dialogs.push({ id: elementId, role, name, modal: asBoolean(properties.get('modal')) })
    }

    if (validationErrors.length < MAX_VALIDATION_ISSUES) {
      // A field flagged invalid, or a live alert region, both surface here so
      // the planner can react to a rejected form without re-reading the page.
      const message = invalid ? description || name || `Field is invalid (${invalid})` : name || description
      if (invalid || (isAlert && message)) {
        validationErrors.push({ elementId, role, message })
      }
    }
  }

  const state: PageStateSnapshot = {
    targetId: input.targetId,
    url: input.url,
    title: normalizeText(input.title, MAX_NAME_LENGTH),
    capturedAt: input.capturedAt,
    elements,
    focusedElementId,
    dialogs,
    validationErrors,
    selectedElementIds,
    truncated,
  }

  return { state, handles }
}
