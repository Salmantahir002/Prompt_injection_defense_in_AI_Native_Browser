// Port of backend/app/services/llm_opencode_zen_service.py — thin proxy in
// front of llmProviderManager. Safety enforcement happens at the route level
// (llm.routes.ts); this service just forwards.
import { llmProviderManager, type ChatResponse } from './llmProviderManager.js'

class LlmOpenCodeZenService {
  get isConfigured(): boolean {
    return llmProviderManager.isConfigured
  }

  get model(): string {
    return llmProviderManager.activeModel
  }

  async chat(params: { prompt: string; pageUrl?: string; pageTitle?: string; pageContent?: string }): Promise<ChatResponse> {
    return llmProviderManager.chat(params)
  }
}

export const llmOpenCodeZenService = new LlmOpenCodeZenService()
