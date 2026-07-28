import type { CdpSession } from './cdpSession.js'
import { BrowserRuntimeError, type ScreenshotParams, type ScreenshotResult } from './runtimeContract.js'

/**
 * Raw CDP inspection primitives. Everything the agent learns about a page
 * comes from these calls — never from a script evaluated inside the page.
 */

export type AXValue = { type?: string; value?: unknown }
export type AXProperty = { name?: string; value?: AXValue }

export type AXNode = {
  nodeId?: string
  ignored?: boolean
  role?: AXValue
  name?: AXValue
  description?: AXValue
  value?: AXValue
  properties?: AXProperty[]
  childIds?: string[]
  backendDOMNodeId?: number
  parentId?: string
}

/**
 * Pulls the accessibility tree for the page. This is the replacement for
 * DOM-walking injected scripts: Chromium has already resolved roles, names,
 * and computed visibility for us, and ignored (decorative) nodes are flagged.
 */
export async function fetchAccessibilityTree(session: CdpSession): Promise<AXNode[]> {
  const result = await session.send('Accessibility.getFullAXTree')
  return Array.isArray(result.nodes) ? (result.nodes as AXNode[]) : []
}

export async function capturePageScreenshot(
  session: CdpSession,
  params: ScreenshotParams,
): Promise<ScreenshotResult> {
  const result = await session.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: params.fullPage === true,
  })

  const dataBase64 = typeof result.data === 'string' ? result.data : ''
  if (!dataBase64) {
    throw new BrowserRuntimeError('CDP_ERROR', 'Page.captureScreenshot returned no image data')
  }

  return { format: 'png', dataBase64, capturedAt: Date.now() }
}
