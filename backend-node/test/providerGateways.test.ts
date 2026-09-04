// Port of backend/app/tests/test_provider_gateways.py — gateways, factory, provider manager.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultProviderConfig } from '../src/services/llmGateways/base.js'
import { PROVIDER_PRESETS, createGateway } from '../src/services/llmGateways/factory.js'
import { OpenAICompatibleGateway } from '../src/services/llmGateways/openaiCompatible.js'
import { AnthropicGateway } from '../src/services/llmGateways/anthropic.js'
import { GeminiGateway } from '../src/services/llmGateways/gemini.js'
import { LlmProviderManager } from '../src/services/llmProviderManager.js'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return jsonResponse(body, status)
    },
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('presets', () => {
  it('preset order and structure', () => {
    expect(PROVIDER_PRESETS).toHaveLength(12)
    expect(PROVIDER_PRESETS.map((p) => p.id)).toEqual([
      'opencode',
      'gemini',
      'anthropic',
      'openai',
      'nvidia',
      'agentrouter',
      'cloudflare',
      'openrouter',
      'tokenrouter',
      'nararouter',
      'openadapter',
      'custom',
    ])
  })
})

describe('factory', () => {
  it('creates the correct gateway instances', () => {
    const openai = createGateway(defaultProviderConfig({ id: 'openai', name: 'OpenAI', api_key: 'sk-test' }))
    expect(openai).toBeInstanceOf(OpenAICompatibleGateway)
    expect((openai as OpenAICompatibleGateway).baseUrl).toBe('https://api.openai.com/v1')

    const openrouter = createGateway(defaultProviderConfig({ id: 'openrouter', name: 'OpenRouter', api_key: 'sk-or-test' }))
    expect(openrouter).toBeInstanceOf(OpenAICompatibleGateway)
    expect((openrouter as OpenAICompatibleGateway).baseUrl).toBe('https://openrouter.ai/api/v1')

    const tokenrouter = createGateway(defaultProviderConfig({ id: 'tokenrouter', name: 'TokenRouter', api_key: 'tr-test' }))
    expect(tokenrouter).toBeInstanceOf(OpenAICompatibleGateway)
    expect((tokenrouter as OpenAICompatibleGateway).baseUrl).toBe('https://api.tokenrouter.com/v1')

    const nararouter = createGateway(defaultProviderConfig({ id: 'nararouter', name: 'NaraRouter', api_key: 'sk-nry-test' }))
    expect(nararouter).toBeInstanceOf(OpenAICompatibleGateway)
    expect((nararouter as OpenAICompatibleGateway).baseUrl).toBe('https://router.bynara.id/v1')

    const openadapter = createGateway(defaultProviderConfig({ id: 'openadapter', name: 'OpenAdapter', api_key: 'sk-cv-test' }))
    expect(openadapter).toBeInstanceOf(OpenAICompatibleGateway)
    expect((openadapter as OpenAICompatibleGateway).baseUrl).toBe('https://api.openadapter.in/v1')

    const custom = createGateway(
      defaultProviderConfig({ id: 'custom-ollama', name: 'Local Ollama', base_url: 'http://localhost:11434/v1', api_key: 'ollama' }),
    )
    expect(custom).toBeInstanceOf(OpenAICompatibleGateway)
    expect((custom as OpenAICompatibleGateway).baseUrl).toBe('http://localhost:11434/v1')

    const agentrouter = createGateway(defaultProviderConfig({ id: 'agentrouter', name: 'AgentRouter', api_key: 'ar-test' }))
    expect(agentrouter).toBeInstanceOf(OpenAICompatibleGateway)
    expect((agentrouter as OpenAICompatibleGateway).baseUrl).toBe('https://agentrouter.org/v1')

    const nvidia = createGateway(defaultProviderConfig({ id: 'nvidia', name: 'NVIDIA NIM', api_key: 'nv-test' }))
    expect(nvidia).toBeInstanceOf(OpenAICompatibleGateway)
    expect((nvidia as OpenAICompatibleGateway).baseUrl).toBe('https://integrate.api.nvidia.com/v1')

    const anthropic = createGateway(
      defaultProviderConfig({ id: 'anthropic', name: 'Anthropic Claude', provider_type: 'anthropic', api_key: 'sk-ant-test' }),
    )
    expect(anthropic).toBeInstanceOf(AnthropicGateway)
    expect((anthropic as AnthropicGateway).baseUrl).toBe('https://api.anthropic.com/v1')

    const gemini = createGateway(
      defaultProviderConfig({ id: 'gemini', name: 'Google Gemini', provider_type: 'gemini', api_key: 'AIzaSyTest' }),
    )
    expect(gemini).toBeInstanceOf(GeminiGateway)
    expect((gemini as GeminiGateway).baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
  })
})

describe('OpenAI-compatible gateway', () => {
  it('list_models parses the data array', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-mock')
      return jsonResponse({ data: [{ id: 'gpt-4o', display_name: 'GPT-4o' }, { id: 'gpt-4o-mini', display_name: 'GPT-4o Mini' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const gw = new OpenAICompatibleGateway(defaultProviderConfig({ id: 'openai', name: 'OpenAI', api_key: 'sk-mock' }))
    const models = await gw.listModels()
    expect(models).toHaveLength(2)
    expect(models[0]!.id).toBe('gpt-4o')
    expect(models[1]!.id).toBe('gpt-4o-mini')
  })

  it('chat_completion extracts the assistant message', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).model).toBe('gpt-4o')
      return jsonResponse({
        model: 'gpt-4o',
        choices: [{ message: { content: 'Hello from OpenAI!', role: 'assistant' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const gw = new OpenAICompatibleGateway(
      defaultProviderConfig({ id: 'openai', name: 'OpenAI', api_key: 'sk-mock', selected_model: 'gpt-4o' }),
    )
    const result = await gw.chatCompletion([{ role: 'user', content: 'Hi' }])
    expect(result.response).toBe('Hello from OpenAI!')
    expect(result.model).toBe('gpt-4o')
    expect(result.usage.prompt_tokens).toBe(10)
    expect(result.usage.completion_tokens).toBe(5)
  })

  it('openrouter includes openrouter/auto at index 0 and sends custom headers', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers['HTTP-Referer']).toBe('https://promptguard.ai')
      expect(headers['X-Title']).toBe('PromptGuard Browser')
      return jsonResponse({ data: [{ id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const gw = new OpenAICompatibleGateway(
      defaultProviderConfig({ id: 'openrouter', name: 'OpenRouter', api_key: 'sk-or-mock' }),
    )
    const models = await gw.listModels()
    expect(models.length).toBeGreaterThan(1)
    expect(models[0]!.id).toBe('openrouter/auto')
    expect(models[0]!.name).toContain('Auto')
  })

  it('openrouter chat_completion defaults to openrouter/auto when no model is chosen', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('openrouter/auto')
      const headers = init?.headers as Record<string, string>
      expect(headers['HTTP-Referer']).toBe('https://promptguard.ai')
      expect(headers['X-Title']).toBe('PromptGuard Browser')
      return jsonResponse({
        model: 'openrouter/auto',
        choices: [{ message: { content: 'Hello via OpenRouter Auto!', role: 'assistant' } }],
        usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const gw = new OpenAICompatibleGateway(
      defaultProviderConfig({ id: 'openrouter', name: 'OpenRouter', api_key: 'sk-or-mock' }),
    )
    const result = await gw.chatCompletion([{ role: 'user', content: 'Hi OpenRouter' }])
    expect(result.response).toBe('Hello via OpenRouter Auto!')
    expect(result.model).toBe('openrouter/auto')
  })
})

describe('Anthropic gateway', () => {
  it('chat_completion splits system prompts and reads content blocks', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers['x-api-key']).toBe('sk-ant-mock')
      expect(headers['anthropic-version']).toBe('2023-06-01')
      const body = JSON.parse(String(init?.body))
      expect(body.system).toBe('You are Kimo')
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi Claude' }])
      return jsonResponse({
        id: 'msg_123',
        model: 'claude-3-5-sonnet-20241022',
        content: [{ type: 'text', text: 'Hello from Claude!' }],
        usage: { input_tokens: 12, output_tokens: 6 },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const gw = new AnthropicGateway(
      defaultProviderConfig({
        id: 'anthropic',
        name: 'Anthropic',
        provider_type: 'anthropic',
        api_key: 'sk-ant-mock',
        selected_model: 'claude-3-5-sonnet-20241022',
      }),
    )
    const result = await gw.chatCompletion([
      { role: 'system', content: 'You are Kimo' },
      { role: 'user', content: 'Hi Claude' },
    ])
    expect(result.response).toBe('Hello from Claude!')
    expect(result.usage.prompt_tokens).toBe(12)
    expect(result.usage.completion_tokens).toBe(6)
  })
})

describe('Gemini gateway', () => {
  it('chat_completion maps messages to Gemini shape', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const asString = String(url)
      expect(asString).toContain('key=AIzaSyMock')
      expect(asString).toContain('models/gemini-1.5-flash:generateContent')
      const body = JSON.parse(String(init?.body))
      expect(body.systemInstruction.parts[0].text).toBe('System instruction')
      expect(body.contents[0].role).toBe('user')
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Hello from Gemini!' }], role: 'model' } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const gw = new GeminiGateway(
      defaultProviderConfig({
        id: 'gemini',
        name: 'Google Gemini',
        provider_type: 'gemini',
        api_key: 'AIzaSyMock',
        selected_model: 'gemini-1.5-flash',
      }),
    )
    const result = await gw.chatCompletion([
      { role: 'system', content: 'System instruction' },
      { role: 'user', content: 'Hi Gemini' },
    ])
    expect(result.response).toBe('Hello from Gemini!')
    expect(result.usage.prompt_tokens).toBe(8)
    expect(result.usage.completion_tokens).toBe(4)
  })
})

describe('provider manager', () => {
  it('returns an error response when the active provider fails', async () => {
    const manager = new LlmProviderManager()
    manager.setActiveProvider(defaultProviderConfig({ id: 'custom', name: 'Custom', api_key: 'test', selected_model: 'custom-m' }))
    ;(manager as unknown as { activeGateway: unknown }).activeGateway = {
      chatCompletion: async () => {
        throw new Error('Connection refused to custom endpoint')
      },
    }

    const result = await manager.chat({ prompt: 'Test prompt' })
    expect(result.response).toContain('LLM provider error (Custom)')
    expect(result.model).toContain('error')
  })

  it('testConnection returns all models without artificial 50-item truncation', async () => {
    const manager = new LlmProviderManager()
    const manyModels = Array.from({ length: 120 }, (_, i) => ({
      id: `model-${i}`,
      object: 'model',
    }))
    const fetchMock = vi.fn(async () => jsonResponse({ data: manyModels }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await manager.testConnection(
      defaultProviderConfig({
        id: 'tokenrouter',
        name: 'TokenRouter',
        api_key: 'sk-test',
      }),
    )

    expect(result.success).toBe(true)
    expect(result.models_count).toBe(120)
    expect(result.models.length).toBe(120)
  })

  it('pins z-ai/glm-5.3-free to index 0 for TokenRouter in listModels', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: 'anthropic/claude-3-5-sonnet', object: 'model' },
          { id: 'z-ai/glm-5.3-free', object: 'model' },
          { id: 'openai/gpt-4o', object: 'model' },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const gw = new OpenAICompatibleGateway(
      defaultProviderConfig({
        id: 'tokenrouter',
        name: 'TokenRouter',
        api_key: 'sk-test',
      }),
    )

    const models = await gw.listModels()
    expect(models[0].id).toBe('z-ai/glm-5.3-free')
  })
})

