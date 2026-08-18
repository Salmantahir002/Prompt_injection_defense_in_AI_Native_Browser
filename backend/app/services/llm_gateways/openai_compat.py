"""
OpenAI-compatible LLM Gateway implementation.
Handles OpenAI, Custom Provider, AgentRouter, and NVIDIA NIM.
"""

import asyncio
import json
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


def _extract_error_message(response: httpx.Response) -> str:
    """Extract human-readable error details from JSON or text response."""
    try:
        data = response.json()
        if isinstance(data, dict):
            if "error" in data and isinstance(data["error"], dict) and "message" in data["error"]:
                msg = str(data["error"]["message"]).strip()
                if msg:
                    return msg
            if "msg" in data and str(data["msg"]).strip():
                return str(data["msg"]).strip()
            if "message" in data and str(data["message"]).strip():
                return str(data["message"]).strip()
            if "error" in data and str(data["error"]).strip():
                return str(data["error"]).strip()
    except Exception:
        pass
    text = response.text.strip()
    return text[:200] if text else f"HTTP {response.status_code}"


CLOUDFLARE_DEFAULT_MODELS: List[ModelInfo] = [
    ModelInfo(id="@cf/meta/llama-3.3-70b-instruct-fp8-fast", name="Llama 3.3 70B Instruct"),
    ModelInfo(id="@cf/meta/llama-3.1-8b-instruct", name="Llama 3.1 8B Instruct"),
    ModelInfo(id="@cf/meta/llama-3.1-70b-instruct", name="Llama 3.1 70B Instruct"),
    ModelInfo(id="@cf/meta/llama-3.2-3b-instruct", name="Llama 3.2 3B Instruct"),
    ModelInfo(id="@cf/meta/llama-3.2-1b-instruct", name="Llama 3.2 1B Instruct"),
    ModelInfo(id="@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", name="DeepSeek R1 Distill Qwen 32B"),
    ModelInfo(id="@cf/qwen/qwen2.5-72b-instruct", name="Qwen 2.5 72B Instruct"),
    ModelInfo(id="@cf/qwen/qwen2.5-coder-32b-instruct", name="Qwen 2.5 Coder 32B Instruct"),
    ModelInfo(id="@cf/mistral/mistral-7b-instruct-v0.1", name="Mistral 7B Instruct"),
    ModelInfo(id="@cf/google/gemma-2-27b-it", name="Gemma 2 27B IT"),
]


class OpenAICompatibleGateway(ProviderGateway):
    """
    Gateway for any OpenAI-compatible endpoint using Bearer token authentication.
    Endpoints used:
      - GET  {base_url}/models or Cloudflare {base_url}/models/search
      - POST {base_url}/chat/completions
    """

    DEFAULT_BASE_URLS: Dict[str, str] = {
        "opencode": "https://opencode.ai/zen/v1",
        "zen": "https://opencode.ai/zen/v1",
        "openai": "https://api.openai.com/v1",
        "agentrouter": "https://agentrouter.org/v1",
        "nvidia": "https://integrate.api.nvidia.com/v1",
        "cloudflare": "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    }

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        base_url = (self.config.base_url or "").strip().rstrip("/")
        if not base_url:
            base_url = self.DEFAULT_BASE_URLS.get(self.config.id, "https://api.openai.com/v1")
        self.base_url = base_url

    def _get_headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        # For AgentRouter, include Stainless SDK headers to satisfy its WAF client allowlist
        if "agentrouter" in self.config.id.lower() or "agentrouter.org" in self.base_url.lower():
            headers.update({
                "User-Agent": "Anthropic/Python 0.39.0",
                "X-Stainless-Lang": "python",
                "X-Stainless-Package-Version": "0.39.0",
                "X-Stainless-OS": "Windows",
                "X-Stainless-Arch": "x64",
                "X-Stainless-Runtime": "cpython",
                "X-Stainless-Runtime-Version": "3.12.0",
            })
        else:
            headers.update({
                "User-Agent": "OpenAI/Python 1.50.0",
                "X-Stainless-Lang": "python",
            })

        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key.strip()}"
        return headers

    async def list_models(self) -> List[ModelInfo]:
        """Fetch live models from {base_url}/models (with automatic URL normalization & Cloudflare search support)."""
        headers = self._get_headers()
        is_cloudflare = "cloudflare" in self.config.id.lower() or "cloudflare.com" in self.base_url.lower()

        candidate_urls: List[str] = []
        if is_cloudflare:
            # Cloudflare Workers AI model search endpoint is at /ai/models/search
            ai_root = self.base_url.replace("/ai/v1", "/ai").replace("/v1", "/ai")
            candidate_urls.append(f"{ai_root}/models/search?task=Text%20Generation")
            candidate_urls.append(f"{ai_root}/models/search")
            candidate_urls.append(f"{self.base_url}/models")
        else:
            candidate_urls.append(f"{self.base_url}/models")
            if not self.base_url.endswith("/v1"):
                candidate_urls.append(f"{self.base_url}/v1/models")

        last_error: Optional[Exception] = None

        for url in candidate_urls:
            try:
                async with httpx.AsyncClient(timeout=15.0, verify=self.config.verify_ssl) as client:
                    response = await client.get(url, headers=headers)
                    if response.status_code in (401, 403):
                        detail = _extract_error_message(response)
                        raise ValueError(f"Authentication failed ({response.status_code}): {detail}")
                    if response.status_code == 405:
                        # Method not allowed on this candidate, continue to next candidate
                        continue
                    response.raise_for_status()

                    try:
                        data = response.json()
                    except json.JSONDecodeError:
                        # Non-JSON HTML response (e.g. root domain), try next candidate URL
                        continue

                models_data = data.get("data", [])
                if not isinstance(models_data, list):
                    if "result" in data and isinstance(data["result"], list):
                        models_data = data["result"]
                    elif isinstance(data, list):
                        models_data = data
                    else:
                        models_data = []

                results: List[ModelInfo] = []
                for item in models_data:
                    if isinstance(item, dict):
                        # Filter out non-text/audio models if task field is present in Cloudflare response
                        if "task" in item and isinstance(item["task"], dict):
                            task_name = str(item["task"].get("name", "")).lower()
                            if task_name and "text" not in task_name and "chat" not in task_name and "generation" not in task_name:
                                continue

                        model_id = item.get("name") if str(item.get("name", "")).startswith("@cf/") else (item.get("id") or item.get("name") or "")
                        raw_name = item.get("display_name") or item.get("name") or model_id
                        
                        # Clean up Cloudflare model names
                        model_name = str(raw_name)
                        if model_name.startswith("@cf/"):
                            parts = model_name.replace("@cf/", "").split("/")
                            model_name = parts[-1].replace("-", " ").title()

                        if model_id:
                            results.append(ModelInfo(id=model_id, name=model_name))
                    elif isinstance(item, str) and item:
                        results.append(ModelInfo(id=item, name=item))

                if results:
                    results.sort(key=lambda m: m.name.lower())
                    return results

            except ValueError:
                raise
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 405:
                    continue
                detail = _extract_error_message(exc.response)
                last_error = ValueError(f"Error ({exc.response.status_code}) from {self.name}: {detail}")
            except httpx.RequestError as exc:
                last_error = ValueError(f"Connection error to {self.name} ({type(exc).__name__}): {exc}")
            except Exception as exc:
                last_error = exc

        # If Cloudflare authenticated but candidate URLs didn't return models, return curated defaults
        if is_cloudflare and not isinstance(last_error, ValueError):
            return CLOUDFLARE_DEFAULT_MODELS

        if last_error:
            if isinstance(last_error, ValueError):
                raise last_error
            raise ValueError(f"Error fetching models from {self.name}: {last_error}") from last_error

        if is_cloudflare:
            return CLOUDFLARE_DEFAULT_MODELS

        return []

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.5,
        max_tokens: int = 1536,
        **kwargs: Any,
    ) -> ChatResult:
        """Send chat completion to {base_url}/chat/completions with retry."""
        target_model = model or self.config.selected_model or "default"
        headers = self._get_headers()
        url = f"{self.base_url}/chat/completions"

        payload: Dict[str, Any] = {
            "model": target_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        # Forward optional formatting parameters
        if "response_format" in kwargs:
            payload["response_format"] = kwargs["response_format"]

        max_retries = 3
        backoff = 1.0

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=60.0, verify=self.config.verify_ssl) as client:
                    response = await client.post(url, headers=headers, json=payload)

                    if response.status_code in (429, 503) and attempt < max_retries - 1:
                        logger.warning(
                            "Provider %s returned status %d. Retrying in %.1fs (attempt %d/%d)...",
                            self.name,
                            response.status_code,
                            backoff,
                            attempt + 1,
                            max_retries,
                        )
                        await asyncio.sleep(backoff)
                        backoff *= 2.0
                        continue

                    response.raise_for_status()
                    data = response.json()

                choices = data.get("choices", [])
                if not choices:
                    raise ValueError(f"No completion choices returned by {self.name}.")

                first_choice = choices[0]
                message_obj = first_choice.get("message", {})
                content = message_obj.get("content") or message_obj.get("reasoning") or ""

                usage_data = data.get("usage", {})
                usage = ChatUsage(
                    prompt_tokens=usage_data.get("prompt_tokens", 0),
                    completion_tokens=usage_data.get("completion_tokens", 0),
                    total_tokens=usage_data.get("total_tokens", 0),
                )

                return ChatResult(
                    response=content,
                    model=data.get("model", target_model),
                    usage=usage,
                    finish_reason=first_choice.get("finish_reason"),
                    raw=data,
                )

            except httpx.HTTPStatusError as exc:
                detail = _extract_error_message(exc.response)
                raise ValueError(
                    f"{self.name} API error ({exc.response.status_code}): {detail}"
                ) from exc
            except httpx.RequestError as exc:
                if attempt < max_retries - 1:
                    await asyncio.sleep(backoff)
                    backoff *= 2.0
                    continue
                raise ValueError(f"Network error connecting to {self.name}: {exc}") from exc
            except Exception as exc:
                logger.exception("Unexpected error calling %s chat_completion", self.name)
                raise ValueError(f"{self.name} chat completion error: {exc}") from exc

        raise ValueError(f"{self.name} failed after {max_retries} attempts.")

    async def validate_key(self) -> bool:
        """Validate credentials by querying list_models."""
        try:
            models = await self.list_models()
            return len(models) > 0
        except Exception:
            return False
