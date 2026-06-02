"""
Crawler Schemas
===============
Pydantic models for the optional Playwright crawler endpoint.
"""

from typing import Optional

from pydantic import BaseModel


class CrawlerRenderRequest(BaseModel):
    """Request body for POST /api/v1/crawler/render-url."""
    url: str
    wait_ms: Optional[int] = 3000


class CrawlerRenderResponse(BaseModel):
    """Response body for POST /api/v1/crawler/render-url."""
    url: str
    page_title: str
    visible_text: str
    hidden_text: str
    html_comments: str
    meta_tags: str
    input_values: str
    success: bool
    error: Optional[str] = None
