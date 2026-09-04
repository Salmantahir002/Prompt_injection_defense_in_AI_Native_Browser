// Port of backend/app/services/llm_gateways/factory.py.
import { ProviderGateway, type ProviderConfig, type ProviderType } from './base.js'
import { OpenAICompatibleGateway } from './openaiCompatible.js'
import { AnthropicGateway } from './anthropic.js'
import { GeminiGateway } from './gemini.js'

export interface ProviderPreset {
  id: string
  name: string
  provider_type: ProviderType
  base_url: string
  is_custom: boolean
  requires_base_url: boolean
  description: string
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    provider_type: 'openai_compatible',
    base_url: 'https://opencode.ai/zen/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'OpenCode Zen curated AI gateway (https://opencode.ai/zen)',
  },
  {
    id: 'gemini',
    name: 'Google AI Studio / Gemini',
    provider_type: 'gemini',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    is_custom: false,
    requires_base_url: false,
    description: 'Google Gemini models via Generative Language API',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    provider_type: 'anthropic',
    base_url: 'https://api.anthropic.com/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'Anthropic Claude models via Messages API',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    provider_type: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'Native OpenAI GPT models',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    provider_type: 'openai_compatible',
    base_url: 'https://integrate.api.nvidia.com/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'NVIDIA NIM microservices API',
  },
  {
    id: 'agentrouter',
    name: 'AgentRouter',
    provider_type: 'openai_compatible',
    base_url: 'https://agentrouter.org/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'AgentRouter LLM proxy (https://agentrouter.org)',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    provider_type: 'openai_compatible',
    base_url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
    is_custom: false,
    requires_base_url: true,
    description: 'Cloudflare Workers AI serverless GPU models (https://dash.cloudflare.com/)',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    provider_type: 'openai_compatible',
    base_url: 'https://openrouter.ai/api/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'OpenRouter unified AI gateway with smart auto-routing (https://openrouter.ai)',
  },
  {
    id: 'tokenrouter',
    name: 'TokenRouter',
    provider_type: 'openai_compatible',
    base_url: 'https://api.tokenrouter.com/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'TokenRouter multi-model access layer (https://tokenrouter.com)',
  },
  {
    id: 'nararouter',
    name: 'NaraRouter',
    provider_type: 'openai_compatible',
    base_url: 'https://router.bynara.id/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'NaraRouter unified AI gateway for coding and applications (https://router.bynara.id)',
  },
  {
    id: 'openadapter',
    name: 'OpenAdapter',
    provider_type: 'openai_compatible',
    base_url: 'https://api.openadapter.in/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'OpenAdapter multi-provider AI gateway (https://openadapter.dev)',
  },
  {
    id: 'custom',
    name: 'Custom Provider',
    provider_type: 'openai_compatible',
    base_url: '',
    is_custom: true,
    requires_base_url: true,
    description: 'OpenAI-compatible gateway, vLLM, Ollama, Groq, or custom proxy',
  },
] as const

/** Create and return the matching ProviderGateway instance for the given configuration. */
export function createGateway(config: ProviderConfig): ProviderGateway {
  if (config.provider_type === 'anthropic' || config.id === 'anthropic') {
    return new AnthropicGateway(config)
  }
  if (config.provider_type === 'gemini' || config.id === 'gemini') {
    return new GeminiGateway(config)
  }
  // Default to the OpenAI-compatible bearer-auth group (OpenAI, Custom, AgentRouter, NVIDIA NIM).
  return new OpenAICompatibleGateway(config)
}
