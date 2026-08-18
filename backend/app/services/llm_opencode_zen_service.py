"""
LLM Gateway Service
===================
Proxy service for forwarding approved prompts to the active LLM Provider Gateway.
Enforces the security-first flow and supports per-user multi-provider configuration.
"""

import logging
from typing import Any, Dict, Optional

from app.core.config import settings
from app.services.llm_provider_manager import llm_provider_manager

logger = logging.getLogger(__name__)


class LlmOpenCodeZenService:
    """
    Handles communication with the active LLM Provider Gateway.
    Safety enforcement is done at the route level — this service proxies safely.
    """

    def __init__(self) -> None:
        self._api_key = settings.OPENCODE_ZEN_API_KEY
        self._base_url = settings.OPENCODE_ZEN_BASE_URL
        self._model = settings.OPENCODE_ZEN_MODEL
        self._verify_ssl = settings.OPENCODE_ZEN_VERIFY_SSL

    @property
    def is_configured(self) -> bool:
        """Check if any LLM provider is active or OpenCode Zen is configured."""
        return llm_provider_manager.is_configured

    @property
    def model(self) -> str:
        """Return the current active model identifier."""
        return llm_provider_manager.active_model

    async def chat(
        self,
        prompt: str,
        page_url: Optional[str] = None,
        page_title: Optional[str] = None,
        page_content: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send a prompt to the active LLM provider and return the response.
        Supports webpage grounding if page_content is provided.
        """
        return await llm_provider_manager.chat(
            prompt=prompt,
            page_url=page_url,
            page_title=page_title,
            page_content=page_content,
        )

    def _placeholder_response(self, prompt: str) -> Dict[str, Any]:
        """Return a placeholder response when the API key is not configured."""
        return llm_provider_manager._placeholder_response(prompt)


# Singleton
llm_opencode_zen_service = LlmOpenCodeZenService()
