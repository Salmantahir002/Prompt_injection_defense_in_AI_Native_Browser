"""
LLM Gateways package.
Provides abstract ProviderGateway, concrete gateway implementations, and factory.
"""

from app.services.llm_gateways.base import (
    ChatResult,
    ChatUsage,
    ModelInfo,
    ProviderConfig,
    ProviderGateway,
    ProviderType,
)
from app.services.llm_gateways.openai_compat import OpenAICompatibleGateway
from app.services.llm_gateways.anthropic_gateway import AnthropicGateway
from app.services.llm_gateways.gemini_gateway import GeminiGateway
from app.services.llm_gateways.factory import PROVIDER_PRESETS, create_gateway

__all__ = [
    "ChatResult",
    "ChatUsage",
    "ModelInfo",
    "ProviderConfig",
    "ProviderGateway",
    "ProviderType",
    "OpenAICompatibleGateway",
    "AnthropicGateway",
    "GeminiGateway",
    "PROVIDER_PRESETS",
    "create_gateway",
]
