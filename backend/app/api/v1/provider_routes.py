"""
Provider Routes
===============
Endpoints for live LLM model fetching, testing provider connectivity,
and managing runtime active provider configuration.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.schemas.provider_schemas import (
    ActiveProviderInfo,
    FetchModelsResponse,
    ProviderConfigRequest,
    ProviderPresetsResponse,
    TestConnectionResponse,
)
from app.services.llm_gateways.base import ProviderConfig, ProviderType
from app.services.llm_gateways.factory import PROVIDER_PRESETS
from app.services.llm_provider_manager import llm_provider_manager

logger = logging.getLogger(__name__)

router = APIRouter()


def _mask_key(key: str) -> str:
    """Safely mask an API key for display, never returning the full secret."""
    if not key or key == "replace_with_your_key":
        return ""
    if len(key) <= 8:
        return "••••••••"
    return f"{key[:4]}••••{key[-4:]}"


@router.get("/providers/presets", response_model=ProviderPresetsResponse)
def get_provider_presets():
    """Return preset definitions for all supported LLM providers."""
    return ProviderPresetsResponse(presets=PROVIDER_PRESETS)


@router.post("/providers/models", response_model=FetchModelsResponse)
async def fetch_provider_models(request: ProviderConfigRequest):
    """
    Live fetch available models from the provider's endpoint using supplied credentials.
    Does not save or activate the configuration.
    """
    if not request.api_key.strip():
        raise HTTPException(status_code=400, detail="API key is required to fetch models.")

    config = ProviderConfig(
        id=request.id.strip(),
        name=request.name.strip(),
        provider_type=request.provider_type,
        base_url=request.base_url.strip() if request.base_url else None,
        api_key=request.api_key.strip(),
        verify_ssl=request.verify_ssl,
        selected_model=request.selected_model,
    )

    try:
        models = await llm_provider_manager.list_models_for_config(config)
        return FetchModelsResponse(
            provider_id=config.id,
            models=models,
            count=len(models),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to fetch models for provider %s", request.id)
        raise HTTPException(status_code=500, detail=f"Unexpected error fetching models: {exc}") from exc


@router.post("/providers/test", response_model=TestConnectionResponse)
async def test_provider_connection(request: ProviderConfigRequest):
    """
    Test connection and credentials for a provider configuration.
    """
    config = ProviderConfig(
        id=request.id.strip(),
        name=request.name.strip(),
        provider_type=request.provider_type,
        base_url=request.base_url.strip() if request.base_url else None,
        api_key=request.api_key.strip(),
        verify_ssl=request.verify_ssl,
        selected_model=request.selected_model,
    )

    result = await llm_provider_manager.test_connection(config)
    return TestConnectionResponse(
        success=result["success"],
        latency_ms=result["latency_ms"],
        models_count=result["models_count"],
        message=result["message"],
        models=result.get("models", []),
    )


@router.post("/providers/active", response_model=ActiveProviderInfo)
def set_active_provider(request: ProviderConfigRequest):
    """
    Set or switch the active runtime LLM provider in the backend.
    """
    config = ProviderConfig(
        id=request.id.strip(),
        name=request.name.strip(),
        provider_type=request.provider_type,
        base_url=request.base_url.strip() if request.base_url else None,
        api_key=request.api_key.strip(),
        verify_ssl=request.verify_ssl,
        selected_model=request.selected_model.strip() if request.selected_model else None,
    )

    llm_provider_manager.set_active_provider(config)

    return ActiveProviderInfo(
        id=config.id,
        name=config.name,
        provider_type=config.provider_type.value,
        base_url=config.base_url,
        is_active=True,
        is_fallback=False,
        selected_model=config.selected_model,
        masked_key=_mask_key(config.api_key),
    )


@router.delete("/providers/active", response_model=ActiveProviderInfo)
def clear_active_provider():
    """
    Clear custom active provider, resetting to default OpenCode Zen fallback.
    """
    llm_provider_manager.clear_active_provider()
    return get_active_provider()


@router.get("/providers/active", response_model=ActiveProviderInfo)
def get_active_provider():
    """
    Get the currently active provider and selected model.
    """
    active = llm_provider_manager.active_config
    if active:
        return ActiveProviderInfo(
            id=active.id,
            name=active.name,
            provider_type=active.provider_type.value,
            base_url=active.base_url,
            is_active=True,
            is_fallback=False,
            selected_model=active.selected_model,
            masked_key=_mask_key(active.api_key),
        )

    return ActiveProviderInfo(
        id="opencode_zen",
        name="OpenCode Zen (Default Fallback)",
        provider_type=ProviderType.OPENAI_COMPATIBLE.value,
        base_url=settings.OPENCODE_ZEN_BASE_URL,
        is_active=False,
        is_fallback=True,
        selected_model=settings.OPENCODE_ZEN_MODEL,
        masked_key=_mask_key(settings.OPENCODE_ZEN_API_KEY),
    )
