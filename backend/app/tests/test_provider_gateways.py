"""
Tests for LLM Gateways, Factory, and Provider Manager.
"""

import pytest
import httpx
from app.services.llm_gateways.base import ProviderConfig, ProviderType
from app.services.llm_gateways.factory import PROVIDER_PRESETS, create_gateway
from app.services.llm_gateways.openai_compat import OpenAICompatibleGateway
from app.services.llm_gateways.anthropic_gateway import AnthropicGateway
from app.services.llm_gateways.gemini_gateway import GeminiGateway
from app.services.llm_provider_manager import LlmProviderManager


def test_provider_presets_order_and_structure():
    assert len(PROVIDER_PRESETS) == 8
    preset_ids = [p["id"] for p in PROVIDER_PRESETS]
    assert preset_ids == [
        "opencode",
        "gemini",
        "anthropic",
        "openai",
        "nvidia",
        "agentrouter",
        "cloudflare",
        "custom",
    ]


def test_factory_creates_correct_gateway_instances():
    openai_cfg = ProviderConfig(id="openai", name="OpenAI", api_key="sk-test")
    gw_openai = create_gateway(openai_cfg)
    assert isinstance(gw_openai, OpenAICompatibleGateway)
    assert gw_openai.base_url == "https://api.openai.com/v1"

    custom_cfg = ProviderConfig(
        id="custom-ollama",
        name="Local Ollama",
        base_url="http://localhost:11434/v1",
        api_key="ollama",
    )
    gw_custom = create_gateway(custom_cfg)
    assert isinstance(gw_custom, OpenAICompatibleGateway)
    assert gw_custom.base_url == "http://localhost:11434/v1"

    agentrouter_cfg = ProviderConfig(id="agentrouter", name="AgentRouter", api_key="ar-test")
    gw_ar = create_gateway(agentrouter_cfg)
    assert isinstance(gw_ar, OpenAICompatibleGateway)
    assert gw_ar.base_url == "https://agentrouter.org/v1"

    nvidia_cfg = ProviderConfig(id="nvidia", name="NVIDIA NIM", api_key="nv-test")
    gw_nv = create_gateway(nvidia_cfg)
    assert isinstance(gw_nv, OpenAICompatibleGateway)
    assert gw_nv.base_url == "https://integrate.api.nvidia.com/v1"

    anthropic_cfg = ProviderConfig(
        id="anthropic",
        name="Anthropic Claude",
        provider_type=ProviderType.ANTHROPIC,
        api_key="sk-ant-test",
    )
    gw_ant = create_gateway(anthropic_cfg)
    assert isinstance(gw_ant, AnthropicGateway)
    assert gw_ant.base_url == "https://api.anthropic.com/v1"

    gemini_cfg = ProviderConfig(
        id="gemini",
        name="Google Gemini",
        provider_type=ProviderType.GEMINI,
        api_key="AIzaSyTest",
    )
    gw_gemini = create_gateway(gemini_cfg)
    assert isinstance(gw_gemini, GeminiGateway)
    assert gw_gemini.base_url == "https://generativelanguage.googleapis.com/v1beta"


@pytest.mark.anyio
async def test_openai_compatible_gateway_list_models(monkeypatch):
    class FakeResponse:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {
                "data": [
                    {"id": "gpt-4o", "display_name": "GPT-4o"},
                    {"id": "gpt-4o-mini", "display_name": "GPT-4o Mini"},
                ]
            }

    async def fake_get(self, url, headers=None, **kwargs):
        assert "Authorization" in headers
        assert headers["Authorization"] == "Bearer sk-mock"
        return FakeResponse()

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    cfg = ProviderConfig(id="openai", name="OpenAI", api_key="sk-mock")
    gw = OpenAICompatibleGateway(cfg)
    models = await gw.list_models()

    assert len(models) == 2
    assert models[0].id == "gpt-4o"
    assert models[1].id == "gpt-4o-mini"


@pytest.mark.anyio
async def test_openai_compatible_gateway_chat_completion(monkeypatch):
    class FakeResponse:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {
                "model": "gpt-4o",
                "choices": [{"message": {"content": "Hello from OpenAI!", "role": "assistant"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            }

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        assert json["model"] == "gpt-4o"
        return FakeResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    cfg = ProviderConfig(id="openai", name="OpenAI", api_key="sk-mock", selected_model="gpt-4o")
    gw = OpenAICompatibleGateway(cfg)
    result = await gw.chat_completion([{"role": "user", "content": "Hi"}])

    assert result.response == "Hello from OpenAI!"
    assert result.model == "gpt-4o"
    assert result.usage.prompt_tokens == 10
    assert result.usage.completion_tokens == 5


@pytest.mark.anyio
async def test_anthropic_gateway_chat_completion(monkeypatch):
    class FakeResponse:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {
                "id": "msg_123",
                "model": "claude-3-5-sonnet-20241022",
                "content": [{"type": "text", "text": "Hello from Claude!"}],
                "usage": {"input_tokens": 12, "output_tokens": 6},
            }

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        assert headers["x-api-key"] == "sk-ant-mock"
        assert headers["anthropic-version"] == "2023-06-01"
        assert json["system"] == "You are Kimo"
        assert json["messages"] == [{"role": "user", "content": "Hi Claude"}]
        return FakeResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    cfg = ProviderConfig(
        id="anthropic",
        name="Anthropic",
        provider_type=ProviderType.ANTHROPIC,
        api_key="sk-ant-mock",
        selected_model="claude-3-5-sonnet-20241022",
    )
    gw = AnthropicGateway(cfg)
    result = await gw.chat_completion([
        {"role": "system", "content": "You are Kimo"},
        {"role": "user", "content": "Hi Claude"},
    ])

    assert result.response == "Hello from Claude!"
    assert result.usage.prompt_tokens == 12
    assert result.usage.completion_tokens == 6


@pytest.mark.anyio
async def test_gemini_gateway_chat_completion(monkeypatch):
    class FakeResponse:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {
                "candidates": [
                    {"content": {"parts": [{"text": "Hello from Gemini!"}], "role": "model"}}
                ],
                "usageMetadata": {"promptTokenCount": 8, "candidatesTokenCount": 4},
            }

    async def fake_post(self, url, params=None, json=None, **kwargs):
        assert params["key"] == "AIzaSyMock"
        assert "models/gemini-1.5-flash:generateContent" in url
        assert json["systemInstruction"]["parts"][0]["text"] == "System instruction"
        assert json["contents"][0]["role"] == "user"
        return FakeResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    cfg = ProviderConfig(
        id="gemini",
        name="Google Gemini",
        provider_type=ProviderType.GEMINI,
        api_key="AIzaSyMock",
        selected_model="gemini-1.5-flash",
    )
    gw = GeminiGateway(cfg)
    result = await gw.chat_completion([
        {"role": "system", "content": "System instruction"},
        {"role": "user", "content": "Hi Gemini"},
    ])

    assert result.response == "Hello from Gemini!"
    assert result.usage.prompt_tokens == 8
    assert result.usage.completion_tokens == 4


@pytest.mark.anyio
async def test_provider_manager_fallback_on_active_provider_failure(monkeypatch):
    manager = LlmProviderManager()

    # Active provider throws error
    class FailingGateway:
        async def chat_completion(self, *args, **kwargs):
            raise httpx.ConnectError("Connection refused to custom endpoint")

    cfg = ProviderConfig(id="custom", name="Custom", api_key="test", selected_model="custom-m")
    manager.set_active_provider(cfg)
    manager._active_gateway = FailingGateway()

    # Fallback OpenCode Zen succeeds
    class MockFallbackGateway:
        async def chat_completion(self, *args, **kwargs):
            from app.services.llm_gateways.base import ChatResult, ChatUsage
            return ChatResult(
                response="Response from fallback OpenCode Zen",
                model="zen-model",
                usage=ChatUsage(prompt_tokens=5, completion_tokens=5),
            )

    manager._fallback_gateway = MockFallbackGateway()
    monkeypatch.setattr(LlmProviderManager, "fallback_is_configured", property(lambda self: True))

    result = await manager.chat("Test prompt")
    assert result["response"] == "Response from fallback OpenCode Zen"
    assert "fallback" in result["model"]
