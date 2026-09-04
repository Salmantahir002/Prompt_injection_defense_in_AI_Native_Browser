// Port of backend/app/services/llm_gateways/base.py — shared types and the
// gateway contract every provider implementation follows.

export type ProviderType = 'openai_compatible' | 'anthropic' | 'gemini'

export interface ModelInfo {
  id: string
  name: string
  description?: string
}

export interface ProviderConfig {
  /** Unique identifier for the provider (e.g. openai, custom_ollama). */
  id: string
  /** Display name for the provider. */
  name: string
  provider_type: ProviderType
  /** Base API endpoint URL. */
  base_url?: string | null
  /** Provider API key. */
  api_key: string
  /** Whether to verify SSL certificates. */
  verify_ssl: boolean
  /** Currently selected model ID. */
  selected_model?: string | null
}

export interface ChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface ChatResult {
  response: string
  model: string
  usage: ChatUsage
  raw_response?: Record<string, unknown> | null
}

export function defaultProviderConfig(partial: Pick<ProviderConfig, 'id' | 'name'> & Partial<ProviderConfig>): ProviderConfig {
  return {
    provider_type: 'openai_compatible',
    base_url: null,
    api_key: '',
    verify_ssl: true,
    selected_model: null,
    ...partial,
  }
}

/** Abstract interface that every LLM provider gateway must implement. */
export abstract class ProviderGateway {
  constructor(public readonly config: ProviderConfig) {}

  get id(): string {
    return this.config.id
  }

  get name(): string {
    return this.config.name
  }

  get providerType(): ProviderType {
    return this.config.provider_type
  }

  get selectedModel(): string | null | undefined {
    return this.config.selected_model
  }

  /** Fetch the live list of available models from the provider. */
  abstract listModels(): Promise<ModelInfo[]>

  /** Send a chat completion request to the provider. */
  abstract chatCompletion(
    messages: Array<{ role: string; content: string }>,
    options?: { model?: string | null; temperature?: number; maxTokens?: number },
  ): Promise<ChatResult>

  /** Validate whether the credentials and endpoint are working. */
  abstract validateKey(): Promise<boolean>
}
