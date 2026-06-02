import type { WebpageContent } from '../types/securityTypes'
import type { BrowserWebViewHandle } from '../components/BrowserWebView'

/**
 * Extracts page content from the active webview by calling its
 * executeJavaScript-based extractContent() method.
 *
 * Returns a structured WebpageContent object or null if extraction fails.
 */
export async function extractPageContent(
  webviewHandle: BrowserWebViewHandle | null,
): Promise<WebpageContent | null> {
  if (!webviewHandle) {
    return null
  }

  try {
    const content = await webviewHandle.extractContent()
    return content
  } catch {
    console.error('[pageContentExtractor] Failed to extract page content')
    return null
  }
}
