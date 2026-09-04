// Port of backend/app/services/llm_gateways/gemini_gateway.py.
import { ProviderGateway, type ChatResult, type ModelInfo, type ProviderConfig } from './base.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
]

export class GeminiGateway extends ProviderGateway {
  static readonly DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

  readonly baseUrl: string

  constructor(config: ProviderConfig) {
    super(config)
    const baseUrl = (config.base_url ?? '').trim().replace(/\/+$/, '')
    this.baseUrl = baseUrl || GeminiGateway.DEFAULT_BASE_URL
  }

  async listModels(): Promise<ModelInfo[]> {
    const url = new URL(`${this.baseUrl}/models`)
    url.searchParams.set('key', this.config.api_key)

    let response: Response
    try {
      response = await fetch(url)
    } catch (exc) {
      throw new Error(`Connection error to Google Gemini: ${exc}`)
    }

    if ([400, 401, 403].includes(response.status)) {
      throw new Error(`Authentication failed (${response.status}): Invalid Google Gemini API key.`)
    }
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 200)
      throw new Error(`Failed to fetch models from Gemini (${response.status}): ${text}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const modelsData = (data.models as Array<Record<string, unknown>>) ?? []
    const results: ModelInfo[] = []
    for (const item of modelsData) {
      if (!item || typeof item !== 'object') continue
      const methods = (item.supportedGenerationMethods as string[]) ?? []
      if (methods.length > 0 && !methods.includes('generateContent')) continue

      const fullName = (item.name as string) ?? ''
      const modelId = fullName.startsWith('models/') ? fullName.replace('models/', '') : fullName
      const displayName = (item.displayName as string) ?? modelId
      const description = item.description as string | undefined
      if (modelId) results.push({ id: modelId, name: String(displayName), description })
    }

    const final = results.length > 0 ? results : DEFAULT_MODELS
    return [...final].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  }

  async chatCompletion(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string | null; temperature?: number; maxTokens?: number } = {},
  ): Promise<ChatResult> {
    const targetModel = options.model || this.config.selected_model || 'gemini-1.5-flash'
    const cleanModel = targetModel.replace('models/', '')
    const url = new URL(`${this.baseUrl}/models/${cleanModel}:generateContent`)
    url.searchParams.set('key', this.config.api_key)

    const systemPrompts: string[] = []
    const geminiContents: Array<Record<string, unknown>> = []
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompts.push(msg.content)
      } else {
        const role = msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user'
        geminiContents.push({ role, parts: [{ text: msg.content }] })
      }
    }
    if (geminiContents.length === 0) geminiContents.push({ role: 'user', parts: [{ text: 'Hello' }] })

    const payload: Record<string, unknown> = {
      contents: geminiContents,
      generationConfig: {
        temperature: options.temperature ?? 0.5,
        maxOutputTokens: options.maxTokens ?? 1536,
      },
    }
    if (systemPrompts.length > 0) {
      payload.systemInstruction = { parts: [{ text: systemPrompts.join('\n\n') }] }
    }

    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let response: Response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } catch (exc) {
        if (attempt < maxRetries - 1) {
          await sleep(1500 * 2 ** attempt)
          lastError = exc instanceof Error ? exc : new Error(String(exc))
          continue
        }
        throw new Error(`Gemini API is unreachable: ${exc}`)
      }

      if ([429, 503, 504].includes(response.status) && attempt < maxRetries - 1) {
        await sleep(1500 * 2 ** attempt)
        continue
      }

      if (!response.ok) {
        const text = (await response.text().catch(() => '')).slice(0, 200)
        throw new Error(`Gemini API error (${response.status}): ${text}`)
      }

      const data = (await response.json()) as Record<string, unknown>
      const candidates = (data.candidates as Array<Record<string, unknown>>) ?? []
      let extractedText = ''
      if (candidates.length > 0) {
        const content = (candidates[0]!.content as Record<string, unknown>) ?? {}
        const parts = (content.parts as Array<Record<string, unknown>>) ?? []
        for (const part of parts) {
          if (part && typeof part.text === 'string') extractedText += part.text
        }
      }

      const usageMeta = (data.usageMetadata as Record<string, unknown>) ?? {}
      const promptTokens = Number(usageMeta.promptTokenCount ?? 0)
      const completionTokens = Number(usageMeta.candidatesTokenCount ?? 0)
      const totalTokens = Number(usageMeta.totalTokenCount ?? promptTokens + completionTokens)

      return {
        response: extractedText,
        model: targetModel,
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens },
        raw_response: data,
      }
    }

    throw new Error(`Gemini request failed after ${maxRetries} retries: ${lastError}`)
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
