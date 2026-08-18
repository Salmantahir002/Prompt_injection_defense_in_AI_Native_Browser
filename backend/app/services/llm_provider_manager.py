"""
LLM Provider Manager.
Coordinates active provider gateways, live model listing, testing, and runtime provider configuration.
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

logger = logging.getLogger(__name__)


class LlmProviderManager:
    """
    Manages runtime LLM providers, model selection, and execution.
    Providers are user-selected; no provider is assumed as default.
    """

    def __init__(self) -> None:
        self._active_config: Optional[ProviderConfig] = None
        self._active_gateway: Optional[ProviderGateway] = None

    @property
    def is_configured(self) -> bool:
        """Check if a custom provider is active with a valid API key."""
        return bool(self._active_config and self._active_config.api_key)

    @property
    def active_config(self) -> Optional[ProviderConfig]:
        return self._active_config

    @property
    def active_model(self) -> str:
        if self._active_config and self._active_config.selected_model:
            return self._active_config.selected_model
        return ""

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
        """Clear the custom active provider."""
        self._active_config = None
        self._active_gateway = None
        logger.info("Active LLM provider cleared. No provider active.")

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
                    "Active provider (%s) chat completion failed: %s",
                    self._active_config.name,
                    exc,
                )
                return {
                    "response": f"LLM provider error ({self._active_config.name}): {exc}. Please check your connection or API key in Settings.",
                    "model": f"{self._active_config.name} (error)",
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0},
                }

        # 2. No provider configured placeholder response
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

        if self._active_gateway and self._active_config and self._active_config.api_key:
            result = await self._active_gateway.chat_completion(
                messages=messages,
                model=target_model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return result.response

        raise ValueError(
            "No LLM provider is currently active. Please configure and activate a provider (OpenAI, Gemini, Anthropic, OpenCode Zen, NVIDIA, or Custom) in Settings."
        )

    def _placeholder_response(self, prompt: str) -> Dict[str, Any]:
        """Return a response when no AI provider is configured."""
        word_count = len(prompt.split())
        return {
            "response": (
                f"🛡️ **Security check passed.**\n\n"
                f"No AI provider is currently connected.\n\n"
                f"To start chatting and asking questions, click the **Model Selection** button or open **Settings** (⚙️) to connect your preferred provider (Google Gemini, Anthropic Claude, OpenAI, OpenCode Zen, NVIDIA NIM, Cloudflare, or Custom Provider)."
            ),
            "model": "no-provider",
            "usage": {
                "prompt_tokens": word_count,
                "completion_tokens": 0,
            },
        }


# Singleton instance
llm_provider_manager = LlmProviderManager()
