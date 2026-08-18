"""
Factory function to instantiate the appropriate ProviderGateway for a given ProviderConfig.
"""

from typing import Dict, Any, List

from app.services.llm_gateways.base import (
    ProviderConfig,
    ProviderGateway,
    ProviderType,
)
from app.services.llm_gateways.openai_compat import OpenAICompatibleGateway
from app.services.llm_gateways.anthropic_gateway import AnthropicGateway
from app.services.llm_gateways.gemini_gateway import GeminiGateway

# Preset definitions for all supported providers
PROVIDER_PRESETS: List[Dict[str, Any]] = [
    {
        "id": "opencode",
        "name": "OpenCode Zen",
        "provider_type": ProviderType.OPENAI_COMPATIBLE.value,
        "base_url": "https://opencode.ai/zen/v1",
        "is_custom": False,
        "requires_base_url": False,
        "description": "OpenCode Zen curated AI gateway (https://opencode.ai/zen)",
    },
    {
        "id": "gemini",
        "name": "Google AI Studio / Gemini",
        "provider_type": ProviderType.GEMINI.value,
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "is_custom": False,
        "requires_base_url": False,
        "description": "Google Gemini models via Generative Language API",
    },
    {
        "id": "anthropic",
        "name": "Anthropic Claude",
        "provider_type": ProviderType.ANTHROPIC.value,
        "base_url": "https://api.anthropic.com/v1",
        "is_custom": False,
        "requires_base_url": False,
        "description": "Anthropic Claude models via Messages API",
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "provider_type": ProviderType.OPENAI_COMPATIBLE.value,
        "base_url": "https://api.openai.com/v1",
        "is_custom": False,
        "requires_base_url": False,
        "description": "Native OpenAI GPT models",
    },
    {
        "id": "nvidia",
        "name": "NVIDIA NIM",
        "provider_type": ProviderType.OPENAI_COMPATIBLE.value,
        "base_url": "https://integrate.api.nvidia.com/v1",
        "is_custom": False,
        "requires_base_url": False,
        "description": "NVIDIA NIM microservices API",
    },
    {
        "id": "agentrouter",
        "name": "AgentRouter",
        "provider_type": ProviderType.OPENAI_COMPATIBLE.value,
        "base_url": "https://agentrouter.org/v1",
        "is_custom": False,
        "requires_base_url": False,
        "description": "AgentRouter LLM proxy (https://agentrouter.org)",
    },
    {
        "id": "cloudflare",
        "name": "Cloudflare Workers AI",
        "provider_type": ProviderType.OPENAI_COMPATIBLE.value,
        "base_url": "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
        "is_custom": False,
        "requires_base_url": True,
        "description": "Cloudflare Workers AI serverless GPU models (https://dash.cloudflare.com/)",
    },
    {
        "id": "custom",
        "name": "Custom Provider",
        "provider_type": ProviderType.OPENAI_COMPATIBLE.value,
        "base_url": "",
        "is_custom": True,
        "requires_base_url": True,
        "description": "OpenAI-compatible gateway, vLLM, Ollama, Groq, or custom proxy",
    },
]


def create_gateway(config: ProviderConfig) -> ProviderGateway:
    """Create and return the matching ProviderGateway instance for the given configuration."""
    provider_type = config.provider_type

    # If provider type is anthropic or provider ID is anthropic
    if provider_type == ProviderType.ANTHROPIC or config.id == "anthropic":
        return AnthropicGateway(config)

    # If provider type is gemini or provider ID is gemini
    if provider_type == ProviderType.GEMINI or config.id == "gemini":
        return GeminiGateway(config)

    # Default to OpenAI-compatible bearer-auth group (OpenAI, Custom, AgentRouter, NVIDIA NIM)
    return OpenAICompatibleGateway(config)
