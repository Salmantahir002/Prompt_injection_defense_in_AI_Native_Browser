"""
LLM Schemas
===========
Pydantic models for the LLM chat proxy endpoint.
"""

from typing import Optional

from pydantic import BaseModel


class LlmChatRequest(BaseModel):
    """Request body for POST /api/v1/llm/chat."""
    prompt: str
    security_check_id: Optional[str] = None


class LlmUsage(BaseModel):
    """Token usage information from the LLM response."""
    prompt_tokens: int
    completion_tokens: int


class LlmChatResponse(BaseModel):
    """Response body for POST /api/v1/llm/chat."""
    response: str
    model: str
    usage: LlmUsage
