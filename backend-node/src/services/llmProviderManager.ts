// Port of backend/app/services/llm_provider_manager.py — coordinates the
// active provider gateway, live model listing, connection testing, and
// runtime provider configuration. Providers are user-selected; none is
// assumed as default.
import { ProviderGateway, type ModelInfo, type ProviderConfig } from './llmGateways/base.js'
import { createGateway } from './llmGateways/factory.js'

export interface TestConnectionResult {
  success: boolean
  latency_ms: number
  models_count: number
  models: Array<{ id: string; name: string }>
  message: string
}

export interface ChatResponse {
  response: string
  model: string
  usage: { prompt_tokens: number; completion_tokens: number }
}

export class LlmProviderManager {
  private activeConfig: ProviderConfig | null = null
  private activeGateway: ProviderGateway | null = null

  /** Check if a custom provider is active with a valid API key. */
  get isConfigured(): boolean {
    return Boolean(this.activeConfig && this.activeConfig.api_key)
  }

  get activeProviderConfig(): ProviderConfig | null {
    return this.activeConfig
  }

  get activeModel(): string {
    return this.activeConfig?.selected_model || ''
  }

  /** Set or switch the active LLM provider. */
  setActiveProvider(config: ProviderConfig): void {
    this.activeConfig = config
    this.activeGateway = createGateway(config)
  }

  /** Clear the custom active provider. */
  clearActiveProvider(): void {
    this.activeConfig = null
    this.activeGateway = null
  }

  /** Fetch live models for a candidate configuration without activating it. */
  async listModelsForConfig(config: ProviderConfig): Promise<ModelInfo[]> {
    return createGateway(config).listModels()
  }

  /**
   * Test connection and model access for a candidate configuration.
   */
  async testConnection(config: ProviderConfig): Promise<TestConnectionResult> {
    const start = performance.now()
    try {
      const gateway = createGateway(config)
      const models = await gateway.listModels()
      const elapsedMs = Math.round((performance.now() - start) * 10) / 10
      return {
        success: true,
        latency_ms: elapsedMs,
        models_count: models.length,
        models: models.map((m) => ({ id: m.id, name: m.name })),
        message: `Connected successfully in ${elapsedMs}ms (${models.length} models available)`,
      }
    } catch (exc) {
      const elapsedMs = Math.round((performance.now() - start) * 10) / 10
      return {
        success: false,
        latency_ms: elapsedMs,
        models_count: 0,
        models: [],
        message: exc instanceof Error ? exc.message : String(exc),
      }
    }
  }

  /** Send a chat prompt to the active LLM provider with webpage grounding. */
  async chat(params: { prompt: string; pageUrl?: string; pageTitle?: string; pageContent?: string; model?: string }): Promise<ChatResponse> {
    const { prompt, pageUrl, pageTitle, pageContent, model } = params

    const systemMessage =
      'You are Kimo, an intelligent, helpful, and concise AI assistant embedded inside an AI-native web browser. ' +
      'You help users answer questions, understand concepts, summarize webpages, analyze articles, and extract information. ' +
      'Always format your response with clean Markdown (use bullet points, headings, bold text, or code blocks where helpful). ' +
      "If webpage context is provided, rely on it to directly and accurately answer the user's questions."

    let userContent = prompt
    if (pageContent && pageContent.trim()) {
      const pageInfo: string[] = []
      if (pageTitle) pageInfo.push(`Title: ${pageTitle.trim()}`)
      if (pageUrl) pageInfo.push(`URL: ${pageUrl.trim()}`)
      let headerText = pageInfo.join('\n')
      if (headerText) headerText = `Active Webpage:\n${headerText}\n\n`

      const trimmedContent = pageContent.trim().slice(0, 25000)
      userContent =
        `${headerText}` +
        `--- BEGIN WEBPAGE CONTENT ---\n` +
        `${trimmedContent}\n` +
        `--- END WEBPAGE CONTENT ---\n\n` +
        `User Request:\n${prompt}`
    }

    const messages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userContent },
    ]

    const isOpenRouter = Boolean(this.activeConfig?.id.toLowerCase().includes('openrouter'))
    const targetModel = model || this.activeConfig?.selected_model || (isOpenRouter ? 'openrouter/auto' : undefined)

    // 1. Try active provider if configured
    if (this.activeGateway && this.activeConfig && this.activeConfig.api_key) {
      try {
        const result = await this.activeGateway.chatCompletion(messages, {
          model: targetModel,
          temperature: 0.5,
          maxTokens: 1536,
        })
        return {
          response: result.response,
          model: result.model,
          usage: { prompt_tokens: result.usage.prompt_tokens, completion_tokens: result.usage.completion_tokens },
        }
      } catch (exc) {
        const message = exc instanceof Error ? exc.message : String(exc)
        return {
          response: `LLM provider error (${this.activeConfig.name}): ${message}. Please check your connection or API key in Settings.`,
          model: `${this.activeConfig.name} (error)`,
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        }
      }
    }

    // 2. No provider configured placeholder response
    return this.placeholderResponse(prompt)
  }

  /**
   * Send a planning request for the autonomous agent. Returns the raw string
   * output from the LLM.
   */
  async planChat(params: { messages: Array<{ role: string; content: string }>; model?: string; temperature?: number; maxTokens?: number }): Promise<string> {
    const { messages, model, temperature = 0.1, maxTokens = 1536 } = params
    const isOpenRouter = Boolean(this.activeConfig?.id.toLowerCase().includes('openrouter'))
    const targetModel = model || this.activeConfig?.selected_model || (isOpenRouter ? 'openrouter/auto' : undefined)

    if (this.activeGateway && this.activeConfig && this.activeConfig.api_key) {
      const result = await this.activeGateway.chatCompletion(messages, { model: targetModel, temperature, maxTokens })
      return result.response
    }

    throw new Error(
      'No LLM provider is currently active. Please configure and activate a provider (OpenAI, Gemini, Anthropic, OpenCode Zen, OpenRouter, TokenRouter, NaraRouter, OpenAdapter, NVIDIA, Cloudflare, or Custom) in Settings.',
    )
  }

  /** Return a response when no AI provider is configured. */
  placeholderResponse(prompt: string): ChatResponse {
    const wordCount = prompt.split(/\s+/).filter(Boolean).length
    return {
      response:
        `🛡️ **Security check passed.**\n\n` +
        `No AI provider is currently connected.\n\n` +
        `To start chatting and asking questions, click the **Model Selection** button or open **Settings** (⚙️) to connect your preferred provider (Google Gemini, Anthropic Claude, OpenAI, OpenRouter, TokenRouter, NaraRouter, OpenAdapter, OpenCode Zen, NVIDIA NIM, Cloudflare, or Custom Provider).`,
      model: 'no-provider',
      usage: { prompt_tokens: wordCount, completion_tokens: 0 },
    }
  }
}

// Singleton instance
export const llmProviderManager = new LlmProviderManager()
