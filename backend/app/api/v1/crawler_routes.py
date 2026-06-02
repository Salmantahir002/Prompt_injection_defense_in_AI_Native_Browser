"""
Crawler Routes
==============
POST /api/v1/crawler/render-url — optional backend URL renderer using Playwright.
This allows the backend to render dynamic pages and extract their content for
indirect prompt injection analysis.
"""

from fastapi import APIRouter, HTTPException

from app.schemas.crawler_schemas import CrawlerRenderRequest, CrawlerRenderResponse
from app.services.playwright_crawler_service import playwright_crawler_service

router = APIRouter()


@router.post("/crawler/render-url", response_model=CrawlerRenderResponse)
async def render_url(request: CrawlerRenderRequest):
    """
    Render a URL using Playwright headless browser and extract its content.

    This is an optional endpoint — the Electron frontend can also extract page
    content via its built-in webview. This endpoint is useful for server-side
    scanning of URLs before they are loaded in the browser.
    """
    if not request.url.strip():
        raise HTTPException(status_code=400, detail="URL cannot be empty.")

    if not playwright_crawler_service.is_available:
        raise HTTPException(
            status_code=503,
            detail="Playwright is not available. Install it with: pip install playwright && playwright install chromium",
        )

    result = await playwright_crawler_service.render_url(
        url=request.url,
        wait_ms=request.wait_ms or 3000,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to render URL: {result['error']}",
        )

    return CrawlerRenderResponse(**result)
