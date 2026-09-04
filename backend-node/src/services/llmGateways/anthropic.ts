// Port of backend/app/services/llm_gateways/anthropic_gateway.py.
import { ProviderGateway, type ChatResult, type ModelInfo, type ProviderConfig } from './base.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
]

export class AnthropicGateway extends ProviderGateway {
  static readonly DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'
  static readonly ANTHROPIC_VERSION = '2023-06-01'

  readonly baseUrl: string

  constructor(config: ProviderConfig) {
    super(config)
    let baseUrl = (config.base_url ?? '').trim().replace(/\/+$/, '')
    if (!baseUrl) {
      baseUrl = AnthropicGateway.DEFAULT_BASE_URL
    } else if (!baseUrl.endsWith('/v1') && baseUrl.includes('anthropic.com')) {
      baseUrl = `${baseUrl}/v1`
    }
    this.baseUrl = baseUrl
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': AnthropicGateway.ANTHROPIC_VERSION,
    }
    if (this.config.api_key) headers['x-api-key'] = this.config.api_key
    return headers
  }

  async listModels(): Promise<ModelInfo[]> {
    const headers = this.headers()
    const url = `${this.baseUrl}/models`

    let response: Response
    try {
      response = await fetch(url, { headers })
    } catch (exc) {
      throw new Error(`Connection error to Anthropic (${exc instanceof Error ? exc.constructor.name : 'RequestError'}): ${exc}`)
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Authentication failed (${response.status}): Invalid Anthropic API key.`)
    }
    if (response.status === 404) return DEFAULT_MODELS
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 200)
      throw new Error(`Failed to fetch models from Anthropic (${response.status}): ${text}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const modelsData = (data.data as Array<Record<string, unknown>>) ?? []
    const results: ModelInfo[] = []
    for (const item of modelsData) {
      if (item && typeof item === 'object') {
        const modelId = (item.id as string) ?? ''
        const modelName = (item.display_name as string) ?? modelId
        if (modelId) results.push({ id: modelId, name: String(modelName) })
      }
    }

    const final = results.length > 0 ? results : DEFAULT_MODELS
    return [...final].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  }

  async chatCompletion(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string | null; temperature?: number; maxTokens?: number } = {},
  ): Promise<ChatResult> {
    const targetModel = options.model || this.config.selected_model || 'claude-3-5-sonnet-20241022'
    const headers = this.headers()
    const url = `${this.baseUrl}/messages`

    const systemPrompts: string[] = []
    const anthropicMessages: Array<{ role: string; content: string }> = []
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompts.push(msg.content)
      } else {
        const role = msg.role === 'assistant' || msg.role === 'model' ? 'assistant' : 'user'
        anthropicMessages.push({ role, content: msg.content })
      }
    }
    if (anthropicMessages.length === 0) anthropicMessages.push({ role: 'user', content: 'Hello' })

    const payload: Record<string, unknown> = {
      model: targetModel,
      max_tokens: options.maxTokens ?? 1536,
      temperature: options.temperature ?? 0.5,
      messages: anthropicMessages,
    }
    if (systemPrompts.length > 0) payload.system = systemPrompts.join('\n\n')

    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let response: Response
      try {
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
      } catch (exc) {
        if (attempt < maxRetries - 1) {
          await sleep(1500 * 2 ** attempt)
          lastError = exc instanceof Error ? exc : new Error(String(exc))
          continue
        }
        throw new Error(`Anthropic API is unreachable: ${exc}`)
      }

      if ([429, 503, 529].includes(response.status) && attempt < maxRetries - 1) {
        await sleep(1500 * 2 ** attempt)
        continue
      }

      if (!response.ok) {
        const text = (await response.text().catch(() => '')).slice(0, 200)
        throw new Error(`Anthropic API error (${response.status}): ${text}`)
      }

      const data = (await response.json()) as Record<string, unknown>
      const contentBlocks = (data.content as Array<Record<string, unknown>>) ?? []
      let extractedText = ''
      for (const block of contentBlocks) {
        if (block && block.type === 'text') extractedText += (block.text as string) ?? ''
      }

      const rawUsage = (data.usage as Record<string, unknown>) ?? {}
      const inputTokens = Number(rawUsage.input_tokens ?? 0)
      const outputTokens = Number(rawUsage.output_tokens ?? 0)

      return {
        response: extractedText,
        model: (data.model as string) ?? targetModel,
        usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
        raw_response: data,
      }
    }

    throw new Error(`Anthropic request failed after ${maxRetries} retries: ${lastError}`)
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
