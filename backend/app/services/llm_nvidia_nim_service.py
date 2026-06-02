"""
LLM NVIDIA NIM Service
======================
Proxy service for forwarding approved prompts to the NVIDIA NIM API.
This endpoint must only be called after the security pipeline returns allowed=true.
"""

import logging
from typing import Any, Dict

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class LlmNvidiaNimService:
    """
    Handles communication with the NVIDIA NIM API for LLM chat completions.
    Safety enforcement is done at the route level — this service just proxies.
    """

    def __init__(self) -> None:
        self._api_key = settings.NVIDIA_NIM_API_KEY
        self._base_url = settings.NVIDIA_NIM_BASE_URL
        self._model = settings.NVIDIA_NIM_MODEL

    @property
    def is_configured(self) -> bool:
        """Check if the NVIDIA NIM API is configured with a real key."""
        return (
            self._api_key != "replace_with_your_key"
            and len(self._api_key) > 10
        )

    async def chat(self, prompt: str) -> Dict[str, Any]:
        """
        Send a prompt to the NVIDIA NIM LLM and return the response.

        Returns a dict with: response, model, usage.
        """
        if not self.is_configured:
            logger.info("NVIDIA NIM not configured — returning placeholder response.")
            return self._placeholder_response(prompt)

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self._base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self._model,
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "You are a helpful AI assistant embedded in a secure browser. "
                                    "Only respond to prompts that have passed the security pipeline."
                                ),
                            },
                            {"role": "user", "content": prompt},
                        ],
                        "max_tokens": 1024,
                        "temperature": 0.7,
                    },
                )

                response.raise_for_status()
                data = response.json()

                choice = data.get("choices", [{}])[0]
                message_content = choice.get("message", {}).get("content", "No response generated.")
                usage = data.get("usage", {})

                return {
                    "response": message_content,
                    "model": data.get("model", self._model),
                    "usage": {
                        "prompt_tokens": usage.get("prompt_tokens", 0),
                        "completion_tokens": usage.get("completion_tokens", 0),
                    },
                }

        except httpx.HTTPStatusError as exc:
            logger.error("NVIDIA NIM API HTTP error: %s — %s", exc.response.status_code, exc.response.text)
            return {
                "response": f"LLM API error: {exc.response.status_code}. Please check your API key and model configuration.",
                "model": self._model,
                "usage": {"prompt_tokens": 0, "completion_tokens": 0},
            }
        except httpx.RequestError as exc:
            logger.error("NVIDIA NIM API request failed: %s", exc)
            return {
                "response": "LLM API is unreachable. Please check your network and API configuration.",
                "model": self._model,
                "usage": {"prompt_tokens": 0, "completion_tokens": 0},
            }

    def _placeholder_response(self, prompt: str) -> Dict[str, Any]:
        """Return a placeholder response when the API key is not configured."""
        word_count = len(prompt.split())
        return {
            "response": (
                f"[Placeholder] Security check passed. "
                f"LLM proxy received your prompt ({word_count} words). "
                f"Configure NVIDIA_NIM_API_KEY in .env to enable real AI responses."
            ),
            "model": f"{self._model} (placeholder)",
            "usage": {
                "prompt_tokens": word_count,
                "completion_tokens": 0,
            },
        }


# Singleton
llm_nvidia_nim_service = LlmNvidiaNimService()
