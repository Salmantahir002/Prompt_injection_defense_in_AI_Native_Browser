"""
LLM Provider Manager.
Coordinates active provider gateways, live model listing, testing, and fallback to OpenCode Zen.
"""

import logging
import time
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.services.llm_gateways.base import (
    ChatResult,
    ModelInfo,
    ProviderConfig,
    ProviderGateway,
    ProviderType,
)
from app.services.llm_gateways.factory import create_gateway
from app.services.llm_gateways.openai_compat import OpenAICompatibleGateway

logger = logging.getLogger(__name__)


class LlmProviderManager:
    """
    Manages runtime LLM providers, model selection, and graceful fallback.
    Ensures the application never crashes even if external endpoints or keys fail.
    """

    def __init__(self) -> None:
        self._active_config: Optional[ProviderConfig] = None
        self._active_gateway: Optional[ProviderGateway] = None
        self._fallback_gateway: Optional[ProviderGateway] = None
        self._init_fallback_gateway()

    def _init_fallback_gateway(self) -> None:
        """Initialize the OpenCode Zen fallback gateway from local .env settings."""
        zen_config = ProviderConfig(
            id="opencode_zen",
            name="OpenCode Zen (Default)",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url=settings.OPENCODE_ZEN_BASE_URL,
            api_key=settings.OPENCODE_ZEN_API_KEY,
            verify_ssl=settings.OPENCODE_ZEN_VERIFY_SSL,
            selected_model=settings.OPENCODE_ZEN_MODEL,
        )
        self._fallback_gateway = OpenAICompatibleGateway(zen_config)

    @property
    def fallback_is_configured(self) -> bool:
        """Check if OpenCode Zen fallback has a valid API key configured."""
        key = settings.OPENCODE_ZEN_API_KEY
        return bool(key and key != "replace_with_your_key" and len(key) > 8)

    @property
    def is_configured(self) -> bool:
        """Check if either a custom provider is active or fallback OpenCode Zen is configured."""
        if self._active_config and self._active_config.api_key:
            return True
        return self.fallback_is_configured

    @property
    def active_config(self) -> Optional[ProviderConfig]:
        return self._active_config

    @property
    def active_model(self) -> str:
        if self._active_config and self._active_config.selected_model:
            return self._active_config.selected_model
        return settings.OPENCODE_ZEN_MODEL

    def set_active_provider(self, config: ProviderConfig) -> None:
        """Set or switch the active LLM provider."""
        self._active_config = config
        self._active_gateway = create_gateway(config)
        logger.info(
            "Active LLM provider set to: %s (%s, model=%s)",
            config.name,
            config.id,
            config.selected_model or "auto",
        )

    def clear_active_provider(self) -> None:
        """Clear the custom active provider, resetting to default fallback."""
        self._active_config = None
        self._active_gateway = None
        logger.info("Active LLM provider cleared. Reverted to default fallback.")

    async def list_models_for_config(self, config: ProviderConfig) -> List[ModelInfo]:
        """Fetch live models for a candidate configuration without activating it."""
        gateway = create_gateway(config)
        return await gateway.list_models()

    async def test_connection(self, config: ProviderConfig) -> Dict[str, Any]:
        """
        Test connection and model access for a candidate configuration.
        Returns dict with: success, latency_ms, models_count, message.
        """
        start_time = time.perf_counter()
        try:
            gateway = create_gateway(config)
            models = await gateway.list_models()
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 1)
            return {
                "success": True,
                "latency_ms": elapsed_ms,
                "models_count": len(models),
                "models": [{"id": m.id, "name": m.name} for m in models[:50]],
                "message": f"Connected successfully in {elapsed_ms}ms ({len(models)} models available)",
            }
        except Exception as exc:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 1)
            return {
                "success": False,
                "latency_ms": elapsed_ms,
                "models_count": 0,
                "models": [],
                "message": str(exc),
            }

    async def chat(
        self,
        prompt: str,
        page_url: Optional[str] = None,
        page_title: Optional[str] = None,
        page_content: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send a chat prompt to the active LLM provider with webpage grounding.
        Falls back to OpenCode Zen if the active provider fails.
        """
        system_message = (
            "You are Kimo, an intelligent, helpful, and concise AI assistant embedded inside an AI-native web browser. "
            "You help users answer questions, understand concepts, summarize webpages, analyze articles, and extract information. "
            "Always format your response with clean Markdown (use bullet points, headings, bold text, or code blocks where helpful). "
            "If webpage context is provided, rely on it to directly and accurately answer the user's questions."
        )

        user_content = prompt
        if page_content and page_content.strip():
            page_info = []
            if page_title:
                page_info.append(f"Title: {page_title.strip()}")
            if page_url:
                page_info.append(f"URL: {page_url.strip()}")
            header_text = "\n".join(page_info)
            if header_text:
                header_text = f"Active Webpage:\n{header_text}\n\n"

            trimmed_content = page_content.strip()[:25000]
            user_content = (
                f"{header_text}"
                f"--- BEGIN WEBPAGE CONTENT ---\n"
                f"{trimmed_content}\n"
                f"--- END WEBPAGE CONTENT ---\n\n"
                f"User Request:\n{prompt}"
            )

        messages: List[Dict[str, str]] = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_content},
        ]

        target_model = model or (self._active_config.selected_model if self._active_config else None)

        # 1. Try active provider if configured
        if self._active_gateway and self._active_config and self._active_config.api_key:
            try:
                result = await self._active_gateway.chat_completion(
                    messages=messages,
                    model=target_model,
                    temperature=0.5,
                    max_tokens=1536,
                )
                return {
                    "response": result.response,
                    "model": result.model,
                    "usage": {
                        "prompt_tokens": result.usage.prompt_tokens,
                        "completion_tokens": result.usage.completion_tokens,
                    },
                }
            except Exception as exc:
                logger.warning(
                    "Active provider (%s) chat completion failed: %s. Falling back to OpenCode Zen.",
                    self._active_config.name,
                    exc,
                )

        # 2. Fallback to OpenCode Zen default
        if self._fallback_gateway and self.fallback_is_configured:
            try:
                result = await self._fallback_gateway.chat_completion(
                    messages=messages,
                    model=settings.OPENCODE_ZEN_MODEL,
                    temperature=0.5,
                    max_tokens=1536,
                )
                return {
                    "response": result.response,
                    "model": f"{result.model} (fallback)",
                    "usage": {
                        "prompt_tokens": result.usage.prompt_tokens,
                        "completion_tokens": result.usage.completion_tokens,
                    },
                }
            except Exception as exc:
                logger.exception("Fallback OpenCode Zen chat completion failed: %s", exc)
                return {
                    "response": f"LLM error: {exc}. Please check your connection or provider settings.",
                    "model": f"{settings.OPENCODE_ZEN_MODEL} (error)",
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0},
                }

        # 3. Unconfigured placeholder response
        return self._placeholder_response(prompt)

    async def plan_chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.1,
        max_tokens: int = 1536,
    ) -> str:
        """
        Send a planning request for the autonomous agent.
        Returns the raw string output from the LLM.
        """
        target_model = model or (self._active_config.selected_model if self._active_config else None)

        # 1. Try active provider
        if self._active_gateway and self._active_config and self._active_config.api_key:
            try:
                result = await self._active_gateway.chat_completion(
                    messages=messages,
                    model=target_model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                return result.response
            except Exception as exc:
                logger.warning(
                    "Active provider (%s) agent planning failed: %s. Falling back to OpenCode Zen.",
                    self._active_config.name,
                    exc,
                )

        # 2. Fallback to OpenCode Zen
        if self._fallback_gateway and self.fallback_is_configured:
            result = await self._fallback_gateway.chat_completion(
                messages=messages,
                model=settings.OPENCODE_ZEN_MODEL,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return result.response

        raise ValueError(
            "No LLM provider is configured. Please configure an LLM provider (OpenAI, Gemini, Anthropic, Custom, etc.) or set OPENCODE_ZEN_API_KEY in .env."
        )

    def _placeholder_response(self, prompt: str) -> Dict[str, Any]:
        """Return a placeholder response when no API key is configured."""
        word_count = len(prompt.split())
        return {
            "response": (
                f"[Placeholder] Security check passed.\n\n"
                f"LLM Gateway received your prompt ({word_count} words).\n\n"
                f"To receive real AI responses, configure your preferred LLM provider (OpenAI, Gemini, Anthropic, NVIDIA, AgentRouter, or Custom) in **Settings**, or configure OPENCODE_ZEN_API_KEY in `.env`."
            ),
            "model": "no-provider (placeholder)",
            "usage": {
                "prompt_tokens": word_count,
                "completion_tokens": 0,
            },
        }


# Singleton instance
llm_provider_manager = LlmProviderManager()
