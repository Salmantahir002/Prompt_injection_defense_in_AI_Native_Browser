"""
LLM OpenCode Zen Service
========================
Proxy service for forwarding approved prompts to the OpenCode Zen API
(https://opencode.ai/docs/zen/, an OpenAI-compatible chat completions API).
This endpoint must only be called after the security pipeline returns allowed=true.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class LlmOpenCodeZenService:
    """
    Handles communication with the OpenCode Zen API for LLM chat completions.
    Safety enforcement is done at the route level — this service just proxies.
    """

    def __init__(self) -> None:
        self._api_key = settings.OPENCODE_ZEN_API_KEY
        self._base_url = settings.OPENCODE_ZEN_BASE_URL
        self._model = settings.OPENCODE_ZEN_MODEL
        self._verify_ssl = settings.OPENCODE_ZEN_VERIFY_SSL

    @property
    def is_configured(self) -> bool:
        """Check if the OpenCode Zen API is configured with a real key."""
        return (
            self._api_key != "replace_with_your_key"
            and len(self._api_key) > 10
        )

    async def chat(
        self,
        prompt: str,
        page_url: Optional[str] = None,
        page_title: Optional[str] = None,
        page_content: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send a prompt to the OpenCode Zen LLM and return the response.
        Supports webpage grounding if page_content is provided.

        Returns a dict with: response, model, usage.
        """
        if not self.is_configured:
            logger.info("OpenCode Zen not configured — returning placeholder response.")
            return self._placeholder_response(prompt)

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

            # Bound the page content to ~25,000 characters so it fits comfortably within LLM context
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

        max_retries = 3
        last_error: Optional[Exception] = None

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=60.0, verify=self._verify_ssl) as client:
                    response = await client.post(
                        f"{self._base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self._api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self._model,
                            "messages": messages,
                            "max_tokens": 1536,
                            "temperature": 0.5,
                        },
                    )

                    if response.status_code in (429, 503, 504) and attempt < max_retries - 1:
                        retry_after = 1.5 * (2 ** attempt)
                        logger.warning(
                            "Chat LLM returned %s; retrying in %.1fs (attempt %d/%d)",
                            response.status_code,
                            retry_after,
                            attempt + 1,
                            max_retries,
                        )
                        await asyncio.sleep(retry_after)
                        continue

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
                if exc.response.status_code in (429, 503, 504) and attempt < max_retries - 1:
                    retry_after = 1.5 * (2 ** attempt)
                    await asyncio.sleep(retry_after)
                    last_error = exc
                    continue
                logger.exception("OpenCode Zen API HTTP error: %s — %s", exc.response.status_code, exc.response.text)
                return {
                    "response": f"LLM API error ({exc.response.status_code}): {exc.response.text}",
                    "model": self._model,
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0},
                }
            except httpx.RequestError as exc:
                if attempt < max_retries - 1:
                    retry_after = 1.5 * (2 ** attempt)
                    await asyncio.sleep(retry_after)
                    last_error = exc
                    continue
                logger.exception("OpenCode Zen API request failed")
                return {
                    "response": f"LLM API is unreachable ({type(exc).__name__}: {exc}). Please check your connection.",
                    "model": self._model,
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0},
                }

        if last_error:
            return {
                "response": f"LLM request failed after retries: {last_error}",
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
                f"Configure OPENCODE_ZEN_API_KEY in .env to enable real AI responses."
            ),
            "model": f"{self._model} (placeholder)",
            "usage": {
                "prompt_tokens": word_count,
                "completion_tokens": 0,
            },
        }


# Singleton
llm_opencode_zen_service = LlmOpenCodeZenService()
