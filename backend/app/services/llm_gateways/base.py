"""
Base classes and schemas for the Multi-Provider LLM Gateway.
"""

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ProviderType(str, Enum):
    OPENAI_COMPATIBLE = "openai_compatible"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"


class ModelInfo(BaseModel):
    id: str
    name: str
    description: Optional[str] = None


class ProviderConfig(BaseModel):
    id: str = Field(..., description="Unique identifier for the provider (e.g. openai, custom_ollama)")
    name: str = Field(..., description="Display name for the provider")
    provider_type: ProviderType = Field(default=ProviderType.OPENAI_COMPATIBLE)
    base_url: Optional[str] = Field(default=None, description="Base API endpoint URL")
    api_key: str = Field(default="", description="Provider API key")
    verify_ssl: bool = Field(default=True, description="Whether to verify SSL certificates")
    selected_model: Optional[str] = Field(default=None, description="Currently selected model ID")


class ChatUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatResult(BaseModel):
    response: str
    model: str
    usage: ChatUsage = Field(default_factory=ChatUsage)
    raw_response: Optional[Dict[str, Any]] = None


class ProviderGateway(ABC):
    """Abstract interface that every LLM provider gateway must implement."""

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    @property
    def id(self) -> str:
        return self.config.id

    @property
    def name(self) -> str:
        return self.config.name

    @property
    def provider_type(self) -> ProviderType:
        return self.config.provider_type

    @property
    def selected_model(self) -> Optional[str]:
        return self.config.selected_model

    @abstractmethod
    async def list_models(self) -> List[ModelInfo]:
        """Fetch the live list of available models from the provider."""
        pass

    @abstractmethod
    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.5,
        max_tokens: int = 1536,
        **kwargs: Any,
    ) -> ChatResult:
        """Send a chat completion request to the provider."""
        pass

    @abstractmethod
    async def validate_key(self) -> bool:
        """Validate whether the credentials and endpoint are working."""
        pass
