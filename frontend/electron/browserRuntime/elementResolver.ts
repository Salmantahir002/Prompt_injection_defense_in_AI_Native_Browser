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

function requireBackendNodeId(handle: ElementHandle): number {
  if (typeof handle.backendNodeId !== 'number') {
    throw new BrowserRuntimeError(
      'ELEMENT_NOT_INTERACTABLE',
      `Element ${handle.elementId} (${handle.role}) has no DOM node behind it`,
    )
  }

  return handle.backendNodeId
}

/**
 * Brings the element into the viewport. Failures are tolerated: a node without
 * a layout object simply produces no quads later, which is the clearer error.
 */
export async function scrollElementIntoView(session: CdpSession, handle: ElementHandle): Promise<void> {
  const backendNodeId = requireBackendNodeId(handle)
  await session.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined)
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
  const backendNodeId = requireBackendNodeId(handle)
  await scrollElementIntoView(session, handle)

  const [quadsResult, viewport] = await Promise.all([
    session.send('DOM.getContentQuads', { backendNodeId }),
    readViewportSize(session),
  ])

  const quads = Array.isArray(quadsResult.quads) ? quadsResult.quads.filter(isQuad) : []
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
  const withinViewport = viewport.width === 0 || viewport.height === 0
    || (point.x >= 0 && point.y >= 0 && point.x <= viewport.width && point.y <= viewport.height)

  if (!withinViewport) {
    throw new BrowserRuntimeError(
      'ELEMENT_NOT_INTERACTABLE',
      `Element ${handle.elementId} (${handle.role}) sits outside the viewport after scrolling`,
    )
  }

  return point
}

/** Moves keyboard focus without a click, used before typing into a field. */
export async function focusElement(session: CdpSession, handle: ElementHandle): Promise<void> {
  const backendNodeId = requireBackendNodeId(handle)
  try {
    await session.send('DOM.focus', { backendNodeId })
  } catch (error) {
    throw new BrowserRuntimeError(
      'ELEMENT_NOT_INTERACTABLE',
      `Element ${handle.elementId} (${handle.role}) could not take focus: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
