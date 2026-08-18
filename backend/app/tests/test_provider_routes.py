"""
Tests for Provider API routes (/api/v1/providers/*).
"""

import pytest
from fastapi.testclient import TestClient
import httpx

from app.main import app
from app.services.llm_gateways.base import ModelInfo
from app.services.llm_provider_manager import llm_provider_manager

client = TestClient(app)


def test_get_presets():
    response = client.get("/api/v1/providers/presets")
    assert response.status_code == 200
    data = response.json()
    assert "presets" in data
    assert len(data["presets"]) == 8
    ids = [p["id"] for p in data["presets"]]
    assert ids == [
        "opencode",
        "gemini",
        "anthropic",
        "openai",
        "nvidia",
        "agentrouter",
        "cloudflare",
        "custom",
    ]


def test_fetch_models_empty_key_rejected():
    response = client.post(
        "/api/v1/providers/models",
        json={"id": "openai", "name": "OpenAI", "api_key": ""},
    )
    assert response.status_code == 400
    assert "API key is required" in response.json()["detail"]


def test_fetch_models_success(monkeypatch):
    async def fake_list(config):
        return [
            ModelInfo(id="gpt-4o", name="GPT-4o"),
            ModelInfo(id="gpt-4o-mini", name="GPT-4o Mini"),
        ]

    monkeypatch.setattr(llm_provider_manager, "list_models_for_config", fake_list)

    response = client.post(
        "/api/v1/providers/models",
        json={"id": "openai", "name": "OpenAI", "api_key": "sk-mock-key"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["provider_id"] == "openai"
    assert len(data["models"]) == 2
    assert data["count"] == 2


def test_test_connection_endpoint(monkeypatch):
    async def fake_test(config):
        return {
            "success": True,
            "latency_ms": 42.5,
            "models_count": 10,
            "models": [{"id": "m1", "name": "Model 1"}],
            "message": "Connected successfully",
        }

    monkeypatch.setattr(llm_provider_manager, "test_connection", fake_test)

    response = client.post(
        "/api/v1/providers/test",
        json={"id": "anthropic", "name": "Anthropic", "api_key": "sk-ant-test"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["latency_ms"] == 42.5
    assert data["models_count"] == 10


def test_set_and_get_active_provider():
    # Set active provider
    response = client.post(
        "/api/v1/providers/active",
        json={
            "id": "openai",
            "name": "OpenAI",
            "api_key": "sk-1234567890abcdef",
            "selected_model": "gpt-4o",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "openai"
    assert data["is_active"] is True
    assert data["selected_model"] == "gpt-4o"
    assert "••••" in data["masked_key"]

    # Get active provider
    get_res = client.get("/api/v1/providers/active")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert get_data["id"] == "openai"
    assert get_data["selected_model"] == "gpt-4o"

    # Reset active provider
    del_res = client.delete("/api/v1/providers/active")
    assert del_res.status_code == 200
    del_data = del_res.json()
    assert del_data["is_fallback"] is True
