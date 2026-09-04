// Port of backend/app/services/llm_gateways/openai_compat.py — handles OpenAI,
// Custom Provider, AgentRouter, and NVIDIA NIM (any Bearer-auth OpenAI-shaped API).
import { ProviderGateway, type ChatResult, type ModelInfo, type ProviderConfig } from './base.js'

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.clone().json()) as Record<string, unknown>
    if (data && typeof data === 'object') {
      const error = data.error
      if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
        const msg = String((error as Record<string, unknown>).message).trim()
        if (msg) return msg
      }
      if (typeof data.msg === 'string' && data.msg.trim()) return data.msg.trim()
      if (typeof data.message === 'string' && data.message.trim()) return data.message.trim()
      if (typeof data.error === 'string' && data.error.trim()) return data.error.trim()
    }
  } catch {
    // fall through to text
  }
  const text = (await response.text().catch(() => '')).trim()
  return text ? text.slice(0, 200) : `HTTP ${response.status}`
}

export const CLOUDFLARE_DEFAULT_MODELS: ModelInfo[] = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B Instruct' },
  { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct' },
  { id: '@cf/meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct' },
  { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B Instruct' },
  { id: '@cf/meta/llama-3.2-1b-instruct', name: 'Llama 3.2 1B Instruct' },
  { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Distill Qwen 32B' },
  { id: '@cf/qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct' },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B Instruct' },
  { id: '@cf/mistral/mistral-7b-instruct-v0.1', name: 'Mistral 7B Instruct' },
  { id: '@cf/google/gemma-2-27b-it', name: 'Gemma 2 27B IT' },
]

const DEFAULT_BASE_URLS: Record<string, string> = {
  opencode: 'https://opencode.ai/zen/v1',
  zen: 'https://opencode.ai/zen/v1',
  openai: 'https://api.openai.com/v1',
  agentrouter: 'https://agentrouter.org/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  cloudflare: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  tokenrouter: 'https://api.tokenrouter.com/v1',
  nararouter: 'https://router.bynara.id/v1',
  nara: 'https://router.bynara.id/v1',
  openadapter: 'https://api.openadapter.in/v1',
}

export const OPENROUTER_DEFAULT_MODELS: ModelInfo[] = [
  { id: 'openrouter/auto', name: 'Auto (Best for prompt / routes automatically)' },
  { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
]

export const TOKENROUTER_DEFAULT_MODELS: ModelInfo[] = [
  { id: 'z-ai/glm-5.3-free', name: 'GLM 5.3 Free (z-ai)' },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2' },
  { id: 'google/gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class OpenAICompatibleGateway extends ProviderGateway {
  readonly baseUrl: string

  constructor(config: ProviderConfig) {
    super(config)
    let baseUrl = (config.base_url ?? '').trim().replace(/\/+$/, '')
    if (!baseUrl) {
      baseUrl = DEFAULT_BASE_URLS[config.id] ?? 'https://api.openai.com/v1'
    }
    this.baseUrl = baseUrl
  }

  private isOpenRouter(): boolean {
    return (
      this.config.id.toLowerCase().includes('openrouter') ||
      this.baseUrl.toLowerCase().includes('openrouter.ai')
    )
  }

  private isTokenRouter(): boolean {
    return (
      this.config.id.toLowerCase().includes('tokenrouter') ||
      this.baseUrl.toLowerCase().includes('tokenrouter')
    )
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    // OpenRouter requires HTTP-Referer and optional X-Title for app rankings
    if (this.isOpenRouter()) {
      headers['HTTP-Referer'] = 'https://promptguard.ai'
      headers['X-Title'] = 'PromptGuard Browser'
    }

    // AgentRouter's WAF client allowlist expects Stainless SDK header fingerprints.
    if (this.config.id.toLowerCase().includes('agentrouter') || this.baseUrl.toLowerCase().includes('agentrouter.org')) {
      Object.assign(headers, {
        'User-Agent': 'Anthropic/Python 0.39.0',
        'X-Stainless-Lang': 'python',
        'X-Stainless-Package-Version': '0.39.0',
        'X-Stainless-OS': 'Windows',
        'X-Stainless-Arch': 'x64',
        'X-Stainless-Runtime': 'cpython',
        'X-Stainless-Runtime-Version': '3.12.0',
      })
    } else {
      Object.assign(headers, {
        'User-Agent': 'OpenAI/Python 1.50.0',
        'X-Stainless-Lang': 'python',
      })
    }

    if (this.config.api_key) {
      headers.Authorization = `Bearer ${this.config.api_key.trim()}`
    }
    return headers
  }

  async listModels(): Promise<ModelInfo[]> {
    const headers = this.headers()
    const isCloudflare = this.config.id.toLowerCase().includes('cloudflare') || this.baseUrl.toLowerCase().includes('cloudflare.com')

    const candidateUrls: string[] = []
    if (isCloudflare) {
      const aiRoot = this.baseUrl.replace('/ai/v1', '/ai').replace('/v1', '/ai')
      candidateUrls.push(`${aiRoot}/models/search?task=Text%20Generation`)
      candidateUrls.push(`${aiRoot}/models/search`)
      candidateUrls.push(`${this.baseUrl}/models`)
    } else {
      candidateUrls.push(`${this.baseUrl}/models`)
      if (!this.baseUrl.endsWith('/v1')) candidateUrls.push(`${this.baseUrl}/v1/models`)
    }

    let lastError: Error | null = null

    for (const url of candidateUrls) {
      try {
        const response = await fetch(url, { headers })
        if (response.status === 401 || response.status === 403) {
          const detail = await extractErrorMessage(response)
          throw new Error(`Authentication failed (${response.status}): ${detail}`)
        }
        if (response.status === 405) continue
        if (!response.ok) {
          const detail = await extractErrorMessage(response)
          lastError = new Error(`Error (${response.status}) from ${this.name}: ${detail}`)
          continue
        }

        let data: unknown
        try {
          data = await response.json()
        } catch {
          continue
        }

        let modelsData: unknown[] = []
        const record = data as Record<string, unknown>
        if (Array.isArray(record?.data)) modelsData = record.data as unknown[]
        else if (Array.isArray(record?.result)) modelsData = record.result as unknown[]
        else if (Array.isArray(data)) modelsData = data as unknown[]

        const results: ModelInfo[] = []
        for (const item of modelsData) {
          if (item && typeof item === 'object') {
            const rec = item as Record<string, unknown>
            if (rec.task && typeof rec.task === 'object') {
              const taskName = String((rec.task as Record<string, unknown>).name ?? '').toLowerCase()
              if (taskName && !taskName.includes('text') && !taskName.includes('chat') && !taskName.includes('generation')) {
                continue
              }
            }

            const nameField = String(rec.name ?? '')
            const modelId = nameField.startsWith('@cf/') ? nameField : String(rec.id ?? rec.name ?? '')
            let modelName = String(rec.display_name ?? rec.name ?? modelId)
            if (modelName.startsWith('@cf/')) {
              const parts = modelName.replace('@cf/', '').split('/')
              modelName = parts[parts.length - 1]!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
            }
            if (modelId) results.push({ id: modelId, name: modelName })
          } else if (typeof item === 'string' && item) {
            results.push({ id: item, name: item })
          }
        }

        if (results.length > 0) {
          results.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
          if (this.isOpenRouter()) {
            const filtered = results.filter((m) => m.id !== 'openrouter/auto' && m.id !== 'auto')
            return [
              { id: 'openrouter/auto', name: 'Auto (Best for prompt / routes automatically)' },
              ...filtered,
            ]
          }
          if (this.isTokenRouter()) {
            const glmFree = results.find((m) => m.id === 'z-ai/glm-5.3-free')
            if (glmFree) {
              const filtered = results.filter((m) => m.id !== 'z-ai/glm-5.3-free')
              return [
                { id: 'z-ai/glm-5.3-free', name: glmFree.name || 'GLM 5.3 Free (z-ai)' },
                ...filtered,
              ]
            }
          }
          return results
        }
      } catch (exc) {
        if (exc instanceof Error && exc.message.startsWith('Authentication failed')) throw exc
        lastError = exc instanceof Error ? exc : new Error(String(exc))
      }
    }

    if (this.isOpenRouter() && !(lastError && lastError.message.startsWith('Authentication failed'))) {
      return OPENROUTER_DEFAULT_MODELS
    }
    if (this.isTokenRouter() && !(lastError && lastError.message.startsWith('Authentication failed'))) {
      return TOKENROUTER_DEFAULT_MODELS
    }
    if (isCloudflare && !(lastError && lastError.message.startsWith('Error ('))) {
      return CLOUDFLARE_DEFAULT_MODELS
    }
    if (lastError) throw lastError
    if (isCloudflare) return CLOUDFLARE_DEFAULT_MODELS
    return []
  }

  async chatCompletion(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string | null; temperature?: number; maxTokens?: number } = {},
  ): Promise<ChatResult> {
    let targetModel = options.model || this.config.selected_model
    if ((!targetModel || targetModel === 'default') && this.isOpenRouter()) {
      targetModel = 'openrouter/auto'
    } else if (!targetModel) {
      targetModel = 'default'
    }
    const headers = this.headers()
    const url = `${this.baseUrl}/chat/completions`

    const payload = {
      model: targetModel,
      messages,
      temperature: options.temperature ?? 0.5,
      max_tokens: options.maxTokens ?? 1536,
    }

    const maxRetries = 3
    let backoff = 1.0

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let response: Response
      try {
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
      } catch (exc) {
        if (attempt < maxRetries - 1) {
          await sleep(backoff * 1000)
          backoff *= 2
          continue
        }
        throw new Error(`Network error connecting to ${this.name}: ${exc instanceof Error ? exc.message : exc}`)
      }

      if ((response.status === 429 || response.status === 503) && attempt < maxRetries - 1) {
        await sleep(backoff * 1000)
        backoff *= 2
        continue
      }

      if (!response.ok) {
        const detail = await extractErrorMessage(response)
        throw new Error(`${this.name} API error (${response.status}): ${detail}`)
      }

      const data = (await response.json()) as Record<string, unknown>
      const choices = (data.choices as Array<Record<string, unknown>>) ?? []
      if (choices.length === 0) throw new Error(`No completion choices returned by ${this.name}.`)

      const firstChoice = choices[0]!
      const messageObj = (firstChoice.message as Record<string, unknown>) ?? {}
      const content = (messageObj.content as string) || (messageObj.reasoning as string) || ''

      const usageData = (data.usage as Record<string, unknown>) ?? {}
      return {
        response: content,
        model: (data.model as string) ?? targetModel,
        usage: {
          prompt_tokens: Number(usageData.prompt_tokens ?? 0),
          completion_tokens: Number(usageData.completion_tokens ?? 0),
          total_tokens: Number(usageData.total_tokens ?? 0),
        },
        raw_response: data,
      }
    }

    throw new Error(`${this.name} failed after ${maxRetries} attempts.`)
  }

  async validateKey(): Promise<boolean> {
    try {
      const models = await this.listModels()
      return models.length > 0
    } catch {
      return false
    }
  }
}
