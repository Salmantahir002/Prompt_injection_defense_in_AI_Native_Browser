import type { CdpSession } from './cdpSession.js'
import { BrowserRuntimeError, type ElementHandle } from './runtimeContract.js'

/**
 * Turns a stored element handle into a viewport coordinate that native input
 * events can target.
 *
 * Coordinates come from `DOM.getContentQuads`, which reports client (viewport)
 * space — the same space `Input.dispatchMouseEvent` expects. Nothing here
 * queries or mutates the page through injected script.
 */

export type ViewportPoint = { x: number; y: number }

type Quad = number[]

/** Minimum quad area in px² below which an element is not a credible hit target. */
const MIN_HIT_AREA = 1

function isQuad(value: unknown): value is Quad {
  return Array.isArray(value) && value.length === 8 && value.every((n) => typeof n === 'number')
}

/** Shoelace formula over the quad's four corners. */
function quadArea(quad: Quad): number {
  let area = 0
  for (let index = 0; index < 4; index += 1) {
    const nextIndex = (index + 1) % 4
    area += quad[index * 2] * quad[nextIndex * 2 + 1] - quad[nextIndex * 2] * quad[index * 2 + 1]
  }

  return Math.abs(area) / 2
}

function quadCenter(quad: Quad): ViewportPoint {
  const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4
  const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4
  return { x, y }
}


/**
 * Recovers a stale or missing backendDOMNodeId by querying the current AX tree.
 */
async function recoverBackendNodeId(session: CdpSession, handle: ElementHandle): Promise<number | undefined> {
  try {
    const axResult = await session.send('Accessibility.getFullAXTree')
    const nodes = Array.isArray(axResult.nodes) ? axResult.nodes : []
    const match = nodes.find((node: Record<string, unknown>) => {
      if (node.nodeId === handle.axNodeId && typeof node.backendDOMNodeId === 'number') return true
      const role = typeof (node.role as { value?: unknown })?.value === 'string' ? (node.role as { value: string }).value : ''
      const name = typeof (node.name as { value?: unknown })?.value === 'string' ? (node.name as { value: string }).value : ''
      return role === handle.role && name === handle.name && typeof node.backendDOMNodeId === 'number'
    })
    if (match && typeof match.backendDOMNodeId === 'number') {
      handle.backendNodeId = match.backendDOMNodeId
      return match.backendDOMNodeId
    }
  } catch {
    // Ignore recovery error
  }
  return undefined
}

/**
 * Brings the element into the viewport. Failures are tolerated: a node without
 * a layout object simply produces no quads later, which is the clearer error.
 */
export async function scrollElementIntoView(session: CdpSession, handle: ElementHandle): Promise<void> {
  let backendNodeId = handle.backendNodeId
  if (typeof backendNodeId !== 'number') {
    backendNodeId = await recoverBackendNodeId(session, handle)
  }
  if (typeof backendNodeId === 'number') {
    await session.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined)
  }
}

type ViewportSize = { width: number; height: number }

export async function readViewportSize(session: CdpSession): Promise<ViewportSize> {
  const metrics = await session.send('Page.getLayoutMetrics')
  const viewport = (metrics.cssLayoutViewport ?? metrics.layoutViewport) as Record<string, unknown> | undefined
  const width = typeof viewport?.clientWidth === 'number' ? viewport.clientWidth : 0
  const height = typeof viewport?.clientHeight === 'number' ? viewport.clientHeight : 0
  return { width, height }
}

/**
 * Resolves the point to aim at. The element is scrolled into view first, then
 * the largest visible content quad wins — matching how a user would click the
 * most substantial part of a wrapped or multi-line element.
 */
export async function resolveElementPoint(session: CdpSession, handle: ElementHandle): Promise<ViewportPoint> {
  let backendNodeId = handle.backendNodeId
  if (typeof backendNodeId !== 'number') {
    backendNodeId = await recoverBackendNodeId(session, handle)
  }

  if (typeof backendNodeId !== 'number') {
    throw new BrowserRuntimeError(
      'ELEMENT_NOT_INTERACTABLE',
      `Element ${handle.elementId} (${handle.role}) has no DOM node behind it`,
    )
  }

  await scrollElementIntoView(session, handle)

  let quadsResult = await session.send('DOM.getContentQuads', { backendNodeId }).catch(() => ({ quads: [] }))
  let quads = Array.isArray(quadsResult.quads) ? quadsResult.quads.filter(isQuad) : []

  // If primary getContentQuads returned nothing, attempt box model fallback
  if (quads.length === 0) {
    try {
      const boxModel = await session.send('DOM.getBoxModel', { backendNodeId })
      const model = boxModel.model as Record<string, unknown> | undefined
      const content = model?.content
      const border = model?.border
      if (isQuad(content)) quads.push(content)
      else if (isQuad(border)) quads.push(border)
    } catch {
      const recoveredId = await recoverBackendNodeId(session, handle)
      if (recoveredId && recoveredId !== backendNodeId) {
        backendNodeId = recoveredId
        await scrollElementIntoView(session, handle)
        quadsResult = await session.send('DOM.getContentQuads', { backendNodeId }).catch(() => ({ quads: [] }))
        quads = Array.isArray(quadsResult.quads) ? quadsResult.quads.filter(isQuad) : []
      }
    }
  }

  const usable = quads
    .filter((quad) => quadArea(quad) > MIN_HIT_AREA)
    .sort((left, right) => quadArea(right) - quadArea(left))

  if (usable.length === 0) {
    throw new BrowserRuntimeError(
      'ELEMENT_NOT_INTERACTABLE',
      `Element ${handle.elementId} (${handle.role}) has no visible area to click`,
    )
  }

  const point = quadCenter(usable[0])
  const viewport = await readViewportSize(session)

  if (viewport.width > 0 && viewport.height > 0) {
    // If coordinate sits slightly offscreen, clamp safely inside viewport bounds
    if (point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) {
      const clampedX = Math.max(5, Math.min(viewport.width - 5, point.x))
      const clampedY = Math.max(5, Math.min(viewport.height - 5, point.y))
      return { x: clampedX, y: clampedY }
    }
  }

  return point
}

/** Moves keyboard focus without a click, used before typing into a field. */
export async function focusElement(session: CdpSession, handle: ElementHandle): Promise<void> {
  let backendNodeId = handle.backendNodeId
  if (typeof backendNodeId !== 'number') {
    backendNodeId = await recoverBackendNodeId(session, handle)
  }

  if (typeof backendNodeId !== 'number') {
    throw new BrowserRuntimeError(
      'ELEMENT_NOT_INTERACTABLE',
      `Element ${handle.elementId} (${handle.role}) has no DOM node behind it`,
    )
  }

  try {
    await session.send('DOM.focus', { backendNodeId })
  } catch (error) {
    const recoveredId = await recoverBackendNodeId(session, handle)
    if (recoveredId && recoveredId !== backendNodeId) {
      try {
        await session.send('DOM.focus', { backendNodeId: recoveredId })
        return
      } catch {
        // fall through
      }
    }

    throw new BrowserRuntimeError(
      'ELEMENT_NOT_INTERACTABLE',
      `Element ${handle.elementId} (${handle.role}) could not take focus: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
