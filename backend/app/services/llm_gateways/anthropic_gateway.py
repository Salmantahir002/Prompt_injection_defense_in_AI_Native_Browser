"""
Anthropic Claude API Gateway implementation.
Uses x-api-key and anthropic-version headers, /v1/models and /v1/messages.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

from app.services.llm_gateways.base import (
    ChatResult,
    ChatUsage,
    ModelInfo,
    ProviderConfig,
    ProviderGateway,
)

logger = logging.getLogger(__name__)


class AnthropicGateway(ProviderGateway):
    """
    Gateway for Anthropic Claude API.
    Endpoints:
      - GET  https://api.anthropic.com/v1/models
      - POST https://api.anthropic.com/v1/messages
    """

    DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
    ANTHROPIC_VERSION = "2023-06-01"

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        base_url = (self.config.base_url or "").strip().rstrip("/")
        if not base_url:
            base_url = self.DEFAULT_BASE_URL
        elif not base_url.endswith("/v1") and "anthropic.com" in base_url:
            base_url = f"{base_url}/v1"
        self.base_url = base_url

    def _get_headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": self.ANTHROPIC_VERSION,
        }
        if self.config.api_key:
            headers["x-api-key"] = self.config.api_key
        return headers

    async def list_models(self) -> List[ModelInfo]:
        """Fetch live models from Anthropic /v1/models."""
        headers = self._get_headers()
        url = f"{self.base_url}/models"

        try:
            async with httpx.AsyncClient(timeout=15.0, verify=self.config.verify_ssl) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()

            models_data = data.get("data", [])
            results: List[ModelInfo] = []

            for item in models_data:
                if isinstance(item, dict):
                    model_id = item.get("id") or ""
                    model_name = item.get("display_name") or model_id
                    if model_id:
                        results.append(ModelInfo(id=model_id, name=str(model_name)))

            # If models endpoint returned empty or fallback is needed, provide standard Claude models
            if not results:
                results = [
                    ModelInfo(id="claude-3-5-sonnet-20241022", name="Claude 3.5 Sonnet"),
                    ModelInfo(id="claude-3-5-haiku-20241022", name="Claude 3.5 Haiku"),
                    ModelInfo(id="claude-3-opus-20240229", name="Claude 3 Opus"),
                ]

            results.sort(key=lambda m: m.name.lower())
            return results

        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in (401, 403):
                raise ValueError(f"Authentication failed ({status}): Invalid Anthropic API key.") from exc
            elif status == 404:
                # Some proxies might not support /models, return known Claude models
                return [
                    ModelInfo(id="claude-3-5-sonnet-20241022", name="Claude 3.5 Sonnet"),
                    ModelInfo(id="claude-3-5-haiku-20241022", name="Claude 3.5 Haiku"),
                    ModelInfo(id="claude-3-opus-20240229", name="Claude 3 Opus"),
                ]
            raise ValueError(f"Failed to fetch models from Anthropic ({status}): {exc.response.text[:200]}") from exc
        except httpx.RequestError as exc:
            raise ValueError(f"Connection error to Anthropic ({type(exc).__name__}): {exc}") from exc
        except Exception as exc:
            logger.exception("Unexpected error in Anthropic list_models")
            raise ValueError(f"Error fetching models from Anthropic: {exc}") from exc

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.5,
        max_tokens: int = 1536,
        **kwargs: Any,
    ) -> ChatResult:
        """Send chat completion to Anthropic /v1/messages."""
        target_model = model or self.config.selected_model or "claude-3-5-sonnet-20241022"
        headers = self._get_headers()
        url = f"{self.base_url}/messages"

        # Separate system messages and user/assistant messages
        system_prompts: List[str] = []
        anthropic_messages: List[Dict[str, str]] = []

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                system_prompts.append(content)
            else:
                # Ensure valid Anthropic role: user or assistant
                anth_role = "assistant" if role in ("assistant", "model") else "user"
                anthropic_messages.append({"role": anth_role, "content": content})

        if not anthropic_messages:
            anthropic_messages.append({"role": "user", "content": "Hello"})

        payload: Dict[str, Any] = {
            "model": target_model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": anthropic_messages,
        }

        if system_prompts:
            payload["system"] = "\n\n".join(system_prompts)

        max_retries = 3
        last_error: Optional[Exception] = None

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=60.0, verify=self.config.verify_ssl) as client:
                    response = await client.post(url, headers=headers, json=payload)

                    if response.status_code in (429, 503, 529) and attempt < max_retries - 1:
                        retry_after = 1.5 * (2 ** attempt)
                        logger.warning(
                            "Anthropic returned HTTP %s; retrying in %.1fs (attempt %d/%d)",
                            response.status_code,
                            retry_after,
                            attempt + 1,
                            max_retries,
                        )
                        await asyncio.sleep(retry_after)
                        continue

                    response.raise_for_status()
                    data = response.json()

                    # Extract response text from content blocks
                    content_blocks = data.get("content", [])
                    extracted_text = ""
                    for block in content_blocks:
                        if isinstance(block, dict) and block.get("type") == "text":
                            extracted_text += block.get("text", "")

                    raw_usage = data.get("usage", {})
                    input_tokens = raw_usage.get("input_tokens", 0)
                    output_tokens = raw_usage.get("output_tokens", 0)
                    usage = ChatUsage(
                        prompt_tokens=input_tokens,
                        completion_tokens=output_tokens,
                        total_tokens=input_tokens + output_tokens,
                    )

                    return ChatResult(
                        response=extracted_text,
                        model=data.get("model", target_model),
                        usage=usage,
                        raw_response=data,
                    )

            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in (429, 503, 529) and attempt < max_retries - 1:
                    retry_after = 1.5 * (2 ** attempt)
                    await asyncio.sleep(retry_after)
                    last_error = exc
                    continue
                logger.error("Anthropic HTTP error: %s — %s", exc.response.status_code, exc.response.text[:200])
                raise ValueError(f"Anthropic API error ({exc.response.status_code}): {exc.response.text[:200]}") from exc
            except httpx.RequestError as exc:
                if attempt < max_retries - 1:
                    retry_after = 1.5 * (2 ** attempt)
                    await asyncio.sleep(retry_after)
                    last_error = exc
                    continue
                logger.error("Anthropic request failed: %s", exc)
                raise ValueError(f"Anthropic API is unreachable ({type(exc).__name__}): {exc}") from exc

        if last_error:
            raise ValueError(f"Anthropic request failed after {max_retries} retries: {last_error}")

        raise ValueError("Unknown error during Anthropic chat completion.")

    async def validate_key(self) -> bool:
        """Validate Anthropic API key."""
        try:
            models = await self.list_models()
            return len(models) > 0
        except Exception as exc:
            logger.warning("Anthropic key validation failed: %s", exc)
            return False
