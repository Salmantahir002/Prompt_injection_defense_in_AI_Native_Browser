// Port of backend/app/api/v1/provider_routes.py — live LLM model fetching,
// testing provider connectivity, and managing the runtime active provider.
import type { FastifyInstance } from 'fastify'
import { ErrorResponseSchema } from '../schemas/common.js'
import {
  ActiveProviderInfoSchema,
  FetchModelsResponseSchema,
  ProviderConfigRequestSchema,
  ProviderPresetsResponseSchema,
  TestConnectionResponseSchema,
  type ProviderConfigRequest,
} from '../schemas/provider.schemas.js'
import type { ProviderConfig } from '../services/llmGateways/base.js'
import { PROVIDER_PRESETS } from '../services/llmGateways/factory.js'
import { llmProviderManager } from '../services/llmProviderManager.js'

/** Safely mask an API key for display, never returning the full secret. */
function maskKey(key: string): string {
  if (!key || key === 'replace_with_your_key') return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

function toProviderConfig(request: ProviderConfigRequest): ProviderConfig {
  return {
    id: request.id.trim(),
    name: request.name.trim(),
    provider_type: request.provider_type ?? 'openai_compatible',
    base_url: request.base_url?.trim() || null,
    api_key: (request.api_key ?? '').trim(),
    verify_ssl: request.verify_ssl ?? true,
    selected_model: request.selected_model ?? null,
  }
}

function activeProviderInfo(config: ProviderConfig | null) {
  if (!config) {
    return {
      id: '',
      name: '',
      provider_type: '',
      base_url: null,
      is_active: false,
      is_fallback: false,
      selected_model: null,
      masked_key: '',
    }
  }
  return {
    id: config.id,
    name: config.name,
    provider_type: config.provider_type,
    base_url: config.base_url ?? null,
    is_active: true,
    is_fallback: false,
    selected_model: config.selected_model ?? null,
    masked_key: maskKey(config.api_key),
  }
}

export default async function providerRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/providers/presets',
    { schema: { response: { 200: ProviderPresetsResponseSchema } } },
    async () => ({ presets: PROVIDER_PRESETS }),
  )

  app.post<{ Body: ProviderConfigRequest }>(
    '/providers/models',
    {
      schema: {
        body: ProviderConfigRequestSchema,
        response: { 200: FetchModelsResponseSchema, 400: ErrorResponseSchema, 500: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const apiKey = (request.body.api_key ?? '').trim()
      if (!apiKey) {
        return reply.code(400).send({ detail: 'API key is required to fetch models.' })
      }

      const config = toProviderConfig(request.body)
      try {
        const models = await llmProviderManager.listModelsForConfig(config)
        return { provider_id: config.id, models, count: models.length }
      } catch (exc) {
        const message = exc instanceof Error ? exc.message : String(exc)
        // Every gateway raises plain Error on failure (mirrors Python's ValueError) — 400.
        return reply.code(400).send({ detail: message })
      }
    },
  )

  app.post<{ Body: ProviderConfigRequest }>(
    '/providers/test',
    { schema: { body: ProviderConfigRequestSchema, response: { 200: TestConnectionResponseSchema } } },
    async (request) => {
      const config = toProviderConfig(request.body)
      const result = await llmProviderManager.testConnection(config)
      return {
        success: result.success,
        latency_ms: result.latency_ms,
        models_count: result.models_count,
        message: result.message,
        models: result.models,
      }
    },
  )

  app.post<{ Body: ProviderConfigRequest }>(
    '/providers/active',
    { schema: { body: ProviderConfigRequestSchema, response: { 200: ActiveProviderInfoSchema } } },
    async (request) => {
      const config = toProviderConfig(request.body)
      llmProviderManager.setActiveProvider(config)
      return activeProviderInfo(config)
    },
  )

  app.delete(
    '/providers/active',
    { schema: { response: { 200: ActiveProviderInfoSchema } } },
    async () => {
      llmProviderManager.clearActiveProvider()
      return activeProviderInfo(llmProviderManager.activeProviderConfig)
    },
  )

  app.get(
    '/providers/active',
    { schema: { response: { 200: ActiveProviderInfoSchema } } },
    async () => activeProviderInfo(llmProviderManager.activeProviderConfig),
  )
}
