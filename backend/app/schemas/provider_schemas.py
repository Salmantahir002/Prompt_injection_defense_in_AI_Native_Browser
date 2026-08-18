"""
Pydantic schemas for the LLM Provider configuration API.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.services.llm_gateways.base import ModelInfo, ProviderType


class ProviderConfigRequest(BaseModel):
    id: str = Field(..., description="Unique provider ID (e.g., openai, custom-local, agentrouter)")
    name: str = Field(..., description="Display name for the provider")
    provider_type: ProviderType = Field(default=ProviderType.OPENAI_COMPATIBLE)
    base_url: Optional[str] = Field(default=None, description="Base URL endpoint")
    api_key: str = Field(default="", description="API key")
    verify_ssl: bool = Field(default=True, description="Whether to verify SSL certificates")
    selected_model: Optional[str] = Field(default=None, description="Selected model ID")


class FetchModelsResponse(BaseModel):
    provider_id: str
    models: List[ModelInfo]
    count: int


class TestConnectionResponse(BaseModel):
    success: bool
    latency_ms: float
    models_count: int
    message: str
    models: List[ModelInfo] = Field(default_factory=list)


class ActiveProviderInfo(BaseModel):
    id: str = ""
    name: str = ""
    provider_type: str = ""
    base_url: Optional[str] = None
    is_active: bool = False
    is_fallback: bool = False
    selected_model: Optional[str] = None
    masked_key: str = ""


class ProviderPresetsResponse(BaseModel):
    presets: List[Dict[str, Any]]
