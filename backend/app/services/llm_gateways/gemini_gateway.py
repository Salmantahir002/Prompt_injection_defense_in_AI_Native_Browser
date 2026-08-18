"""
Google AI Studio / Gemini API Gateway implementation.
Uses ?key=<key> query param authentication and generateContent endpoint.
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


class GeminiGateway(ProviderGateway):
    """
    Gateway for Google AI Studio / Gemini API.
    Endpoints:
      - GET  https://generativelanguage.googleapis.com/v1beta/models?key={api_key}
      - POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}
    """

    DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        base_url = (self.config.base_url or "").strip().rstrip("/")
        if not base_url:
            base_url = self.DEFAULT_BASE_URL
        self.base_url = base_url

    async def list_models(self) -> List[ModelInfo]:
        """Fetch live models from Gemini API."""
        url = f"{self.base_url}/models"
        params = {"key": self.config.api_key}

        try:
            async with httpx.AsyncClient(timeout=15.0, verify=self.config.verify_ssl) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()

            models_data = data.get("models", [])
            results: List[ModelInfo] = []

            for item in models_data:
                if not isinstance(item, dict):
                    continue
                # Filter only models supporting generateContent
                methods = item.get("supportedGenerationMethods", [])
                if methods and "generateContent" not in methods:
                    continue

                full_name = item.get("name", "")
                # Strip models/ prefix for clean model ID
                model_id = full_name.replace("models/", "") if full_name.startswith("models/") else full_name
                display_name = item.get("displayName") or model_id
                description = item.get("description")

                if model_id:
                    results.append(ModelInfo(id=model_id, name=str(display_name), description=description))

            if not results:
                results = [
                    ModelInfo(id="gemini-1.5-flash", name="Gemini 1.5 Flash"),
                    ModelInfo(id="gemini-1.5-pro", name="Gemini 1.5 Pro"),
                    ModelInfo(id="gemini-2.0-flash", name="Gemini 2.0 Flash"),
                ]

            results.sort(key=lambda m: m.name.lower())
            return results

        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in (400, 401, 403):
                raise ValueError(f"Authentication failed ({status}): Invalid Google Gemini API key.") from exc
            raise ValueError(f"Failed to fetch models from Gemini ({status}): {exc.response.text[:200]}") from exc
        except httpx.RequestError as exc:
            raise ValueError(f"Connection error to Google Gemini ({type(exc).__name__}): {exc}") from exc
        except Exception as exc:
            logger.exception("Unexpected error in Gemini list_models")
            raise ValueError(f"Error fetching models from Gemini: {exc}") from exc

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.5,
        max_tokens: int = 1536,
        **kwargs: Any,
    ) -> ChatResult:
        """Send content generation request to Gemini generateContent endpoint."""
        target_model = model or self.config.selected_model or "gemini-1.5-flash"
        # Ensure model ID doesn't have double models/ prefix
        clean_model = target_model.replace("models/", "")

        url = f"{self.base_url}/models/{clean_model}:generateContent"
        params = {"key": self.config.api_key}

        # Convert standard OpenAI/Chat messages into Gemini format
        system_prompts: List[str] = []
        gemini_contents: List[Dict[str, Any]] = []

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                system_prompts.append(content)
            else:
                gemini_role = "model" if role in ("assistant", "model") else "user"
                gemini_contents.append({
                    "role": gemini_role,
                    "parts": [{"text": content}],
                })

        if not gemini_contents:
            gemini_contents.append({"role": "user", "parts": [{"text": "Hello"}]})

        payload: Dict[str, Any] = {
            "contents": gemini_contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }

        if system_prompts:
            payload["systemInstruction"] = {
                "parts": [{"text": "\n\n".join(system_prompts)}],
            }

        max_retries = 3
        last_error: Optional[Exception] = None

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=60.0, verify=self.config.verify_ssl) as client:
                    response = await client.post(url, params=params, json=payload)

                    if response.status_code in (429, 503, 504) and attempt < max_retries - 1:
                        retry_after = 1.5 * (2 ** attempt)
                        logger.warning(
                            "Gemini returned HTTP %s; retrying in %.1fs (attempt %d/%d)",
                            response.status_code,
                            retry_after,
                            attempt + 1,
                            max_retries,
                        )
                        await asyncio.sleep(retry_after)
                        continue

                    response.raise_for_status()
                    data = response.json()

                    # Extract candidate text
                    candidates = data.get("candidates", [])
                    extracted_text = ""
                    if candidates and isinstance(candidates, list):
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for part in parts:
                            if isinstance(part, dict) and "text" in part:
                                extracted_text += part["text"]

                    usage_meta = data.get("usageMetadata", {})
                    prompt_tokens = usage_meta.get("promptTokenCount", 0)
                    completion_tokens = usage_meta.get("candidatesTokenCount", 0)
                    total_tokens = usage_meta.get("totalTokenCount", prompt_tokens + completion_tokens)

                    usage = ChatUsage(
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        total_tokens=total_tokens,
                    )

                    return ChatResult(
                        response=extracted_text,
                        model=target_model,
                        usage=usage,
                        raw_response=data,
                    )

            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in (429, 503, 504) and attempt < max_retries - 1:
                    retry_after = 1.5 * (2 ** attempt)
                    await asyncio.sleep(retry_after)
                    last_error = exc
                    continue
                logger.error("Gemini HTTP error: %s — %s", exc.response.status_code, exc.response.text[:200])
                raise ValueError(f"Gemini API error ({exc.response.status_code}): {exc.response.text[:200]}") from exc
            except httpx.RequestError as exc:
                if attempt < max_retries - 1:
                    retry_after = 1.5 * (2 ** attempt)
                    await asyncio.sleep(retry_after)
                    last_error = exc
                    continue
                logger.error("Gemini request failed: %s", exc)
                raise ValueError(f"Gemini API is unreachable ({type(exc).__name__}): {exc}") from exc

        if last_error:
            raise ValueError(f"Gemini request failed after {max_retries} retries: {last_error}")

        raise ValueError("Unknown error during Gemini chat completion.")

    async def validate_key(self) -> bool:
        """Validate Gemini API key."""
        try:
            models = await self.list_models()
            return len(models) > 0
        except Exception as exc:
            logger.warning("Gemini key validation failed: %s", exc)
            return False
