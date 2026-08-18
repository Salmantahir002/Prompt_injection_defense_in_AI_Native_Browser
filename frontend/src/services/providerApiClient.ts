/**
 * Frontend Client for the Multi-Provider Gateway API & Electron safeStorage bridge.
 */

import type {
  ActiveProviderInfo,
  ClientProviderConfig,
  FetchModelsResult,
  ModelInfo,
  ProviderPreset,
  TestConnectionResult,
} from '../types/providerTypes'

const API_BASE_URL = 'http://127.0.0.1:8000/api/v1'

export const FALLBACK_PRESETS: ProviderPreset[] = [
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    provider_type: 'openai_compatible',
    base_url: 'https://opencode.ai/zen/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'Curated models including Claude, GPT, Gemini and more',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    provider_type: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'GPT models for fast, capable general AI tasks',
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
    id: 'nvidia',
    name: 'NVIDIA NIM',
    provider_type: 'openai_compatible',
    base_url: 'https://integrate.api.nvidia.com/v1',
    is_custom: false,
    requires_base_url: false,
    description: 'NVIDIA NIM microservices API',
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
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    provider_type: 'openai_compatible',
    base_url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
    is_custom: false,
    requires_base_url: true,
    description: 'Cloudflare Workers AI serverless GPU models (https://dash.cloudflare.com/)',
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
]

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    try {
      const errorJson = JSON.parse(errorText)
      throw new Error(errorJson.detail || errorText || `Request failed with status ${response.status}`)
    } catch (e: any) {
      if (e.message && e.message !== errorText) throw e
      throw new Error(errorText || `Request failed with status ${response.status}`)
    }
  }

  return response.json() as Promise<T>
}

/**
 * Fetch provider presets metadata from backend.
 */
export async function getProviderPresets(): Promise<ProviderPreset[]> {
  try {
    const res = await requestJson<{ presets: ProviderPreset[] }>('/providers/presets')
    return res.presets || FALLBACK_PRESETS
  } catch {
    return FALLBACK_PRESETS
  }
}

/**
 * Live fetch models from a provider endpoint using candidate credentials.
 */
export async function fetchProviderModels(config: ClientProviderConfig): Promise<ModelInfo[]> {
  const res = await requestJson<FetchModelsResult>('/providers/models', {
    method: 'POST',
    body: JSON.stringify({
      id: config.id,
      name: config.name,
      provider_type: config.provider_type,
      base_url: config.base_url || undefined,
      api_key: config.api_key || '',
      verify_ssl: config.verify_ssl ?? true,
      selected_model: config.selected_model,
    }),
  })
  return res.models || []
}

/**
 * Test connectivity with candidate provider credentials.
 */
export async function testProviderConnection(config: ClientProviderConfig): Promise<TestConnectionResult> {
  return requestJson<TestConnectionResult>('/providers/test', {
    method: 'POST',
    body: JSON.stringify({
      id: config.id,
      name: config.name,
      provider_type: config.provider_type,
      base_url: config.base_url || undefined,
      api_key: config.api_key || '',
      verify_ssl: config.verify_ssl ?? true,
      selected_model: config.selected_model,
    }),
  })
}

/**
 * Get active provider info from backend.
 */
export async function getBackendActiveProvider(): Promise<ActiveProviderInfo> {
  return requestJson<ActiveProviderInfo>('/providers/active')
}

/**
 * Set active provider directly in the backend.
 */
export async function setBackendActiveProvider(config: ClientProviderConfig): Promise<ActiveProviderInfo> {
  return requestJson<ActiveProviderInfo>('/providers/active', {
    method: 'POST',
    body: JSON.stringify({
      id: config.id,
      name: config.name,
      provider_type: config.provider_type,
      base_url: config.base_url || undefined,
      api_key: config.api_key || '',
      verify_ssl: config.verify_ssl ?? true,
      selected_model: config.selected_model,
    }),
  })
}

/**
 * Get all stored provider configurations from Electron secure storage (or localStorage fallback).
 */
export async function getAllStoredProviders(): Promise<ClientProviderConfig[]> {
  const electron = (window as any).electronAPI
  if (electron?.providers?.getAll) {
    try {
      return await electron.providers.getAll()
    } catch (err) {
      console.warn('[providerApiClient] electron.providers.getAll failed:', err)
    }
  }

  // Web / fallback localStorage
  try {
    const raw = window.localStorage.getItem('promptguard.providers')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * Save provider configuration securely in Electron OS keychain (or localStorage fallback).
 */
export async function saveStoredProvider(config: ClientProviderConfig & { set_active?: boolean }): Promise<ClientProviderConfig> {
  const electron = (window as any).electronAPI
  if (electron?.providers?.save) {
    const saved = await electron.providers.save(config)
    return saved
  }

  // Fallback for browser mode
  const all = await getAllStoredProviders()
  const existingIndex = all.findIndex((p) => p.id === config.id)
  const item: ClientProviderConfig = {
    ...config,
    models: config.models || (existingIndex >= 0 ? all[existingIndex].models : []),
    masked_key: config.api_key ? `••••••••` : config.masked_key,
    has_key: Boolean(config.api_key || config.has_key),
    is_active: config.set_active ? true : config.is_active,
  }
  delete item.api_key

  if (config.set_active) {
    for (const p of all) {
      p.is_active = false
    }
  }

  if (existingIndex >= 0) {
    all[existingIndex] = item
  } else {
    all.push(item)
  }

  window.localStorage.setItem('promptguard.providers', JSON.stringify(all))
  if (config.set_active) {
    await setBackendActiveProvider(config).catch(() => undefined)
  }
  return item
}

/**
 * Delete a stored provider configuration.
 */
export async function deleteStoredProvider(providerId: string): Promise<boolean> {
  const electron = (window as any).electronAPI
  if (electron?.providers?.delete) {
    const res = await electron.providers.delete(providerId)
    return res.ok
  }

  const all = await getAllStoredProviders()
  const filtered = all.filter((p) => p.id !== providerId)
  window.localStorage.setItem('promptguard.providers', JSON.stringify(filtered))
  return true
}

/**
 * Set the active provider in storage and backend.
 */
export async function setActiveStoredProvider(id: string | null, selectedModel?: string): Promise<boolean> {
  const electron = (window as any).electronAPI
  if (electron?.providers?.setActive) {
    const res = await electron.providers.setActive({ id, selected_model: selectedModel })
    return res.ok
  }

  const all = await getAllStoredProviders()
  for (const p of all) {
    p.is_active = p.id === id
    if (p.id === id && selectedModel) {
      p.selected_model = selectedModel
    }
  }
  window.localStorage.setItem('promptguard.providers', JSON.stringify(all))

  const active = all.find((p) => p.id === id)
  if (active) {
    await setBackendActiveProvider(active).catch(() => undefined)
  }
  return true
}
