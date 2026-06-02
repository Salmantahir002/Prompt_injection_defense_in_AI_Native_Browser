"""
Playwright Crawler Service
==========================
Optional backend-side page renderer for dynamic webpages.
Uses Playwright to load a URL in a headless browser and extract DOM content.
"""

import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)


class PlaywrightCrawlerService:
    """
    Renders URLs using Playwright headless browser and extracts page content.
    This is an optional service — the frontend can also extract content via its webview.
    """

    def __init__(self) -> None:
        self._available: bool | None = None

    @property
    def is_available(self) -> bool:
        """Check if Playwright is installed and browsers are available."""
        if self._available is not None:
            return self._available

        try:
            from playwright.async_api import async_playwright  # noqa: F401
            self._available = True
        except ImportError:
            logger.warning("Playwright is not installed. Crawler endpoint will be unavailable.")
            self._available = False

        return self._available

    async def render_url(self, url: str, wait_ms: int = 3000) -> Dict[str, Any]:
        """
        Render a URL and extract page content using Playwright.

        Returns dict with: url, page_title, visible_text, hidden_text,
                          html_comments, meta_tags, input_values, success, error
        """
        if not self.is_available:
            return self._error_response(url, "Playwright is not installed. Run: pip install playwright && playwright install chromium")

        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()

                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=15000)

                    if wait_ms > 0:
                        await page.wait_for_timeout(wait_ms)

                    # Extract content using JavaScript
                    content = await page.evaluate("""
                        () => {
                            function getComments(root) {
                                const comments = [];
                                const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, null, false);
                                let node;
                                while (node = walker.nextNode()) { comments.push(node.nodeValue || ''); }
                                return comments.join(' ');
                            }

                            function getHidden() {
                                const hidden = [];
                                document.querySelectorAll('[hidden],[aria-hidden="true"]').forEach(el => {
                                    if (el.textContent) hidden.push(el.textContent.trim());
                                });
                                document.querySelectorAll('[style]').forEach(el => {
                                    const s = el.getAttribute('style') || '';
                                    if (s.includes('display:none') || s.includes('display: none') ||
                                        s.includes('visibility:hidden') || s.includes('visibility: hidden')) {
                                        if (el.textContent) hidden.push(el.textContent.trim());
                                    }
                                });
                                return hidden.join(' ');
                            }

                            function getMeta() {
                                const metas = [];
                                document.querySelectorAll('meta[content]').forEach(m => {
                                    metas.push(m.getAttribute('content'));
                                });
                                return metas.join(' ');
                            }

                            function getInputs() {
                                const inputs = [];
                                document.querySelectorAll('input,textarea').forEach(el => {
                                    const v = el.value || el.textContent || '';
                                    if (v.trim()) inputs.push(v.trim());
                                });
                                return inputs.join(' ');
                            }

                            return {
                                page_title: document.title || '',
                                visible_text: document.body ? document.body.innerText.substring(0, 50000) : '',
                                hidden_text: getHidden().substring(0, 10000),
                                html_comments: getComments(document).substring(0, 10000),
                                meta_tags: getMeta().substring(0, 5000),
                                input_values: getInputs().substring(0, 5000),
                            };
                        }
                    """)

                    return {
                        "url": url,
                        "page_title": content.get("page_title", ""),
                        "visible_text": content.get("visible_text", ""),
                        "hidden_text": content.get("hidden_text", ""),
                        "html_comments": content.get("html_comments", ""),
                        "meta_tags": content.get("meta_tags", ""),
                        "input_values": content.get("input_values", ""),
                        "success": True,
                        "error": None,
                    }

                except Exception as page_error:
                    logger.error("Playwright page error for '%s': %s", url, page_error)
                    return self._error_response(url, str(page_error))

                finally:
                    await browser.close()

        except Exception as exc:
            logger.error("Playwright browser error: %s", exc)
            return self._error_response(url, str(exc))

    @staticmethod
    def _error_response(url: str, error: str) -> Dict[str, Any]:
        return {
            "url": url,
            "page_title": "",
            "visible_text": "",
            "hidden_text": "",
            "html_comments": "",
            "meta_tags": "",
            "input_values": "",
            "success": False,
            "error": error,
        }


# Singleton
playwright_crawler_service = PlaywrightCrawlerService()
