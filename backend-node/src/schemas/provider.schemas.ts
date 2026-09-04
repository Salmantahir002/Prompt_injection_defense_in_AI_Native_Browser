// Port of backend/app/schemas/provider_schemas.py.
import { Type, type Static } from '@sinclair/typebox'

export const ProviderTypeSchema = Type.Union([
  Type.Literal('openai_compatible'),
  Type.Literal('anthropic'),
  Type.Literal('gemini'),
])

export const ModelInfoSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
})

export const ProviderConfigRequestSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  provider_type: Type.Optional(ProviderTypeSchema),
  base_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  api_key: Type.Optional(Type.String()),
  verify_ssl: Type.Optional(Type.Boolean()),
  selected_model: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

export const FetchModelsResponseSchema = Type.Object({
  provider_id: Type.String(),
  models: Type.Array(ModelInfoSchema),
  count: Type.Integer(),
})

export const TestConnectionResponseSchema = Type.Object({
  success: Type.Boolean(),
  latency_ms: Type.Number(),
  models_count: Type.Integer(),
  message: Type.String(),
  models: Type.Array(ModelInfoSchema),
})

export const ActiveProviderInfoSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  provider_type: Type.String(),
  base_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_active: Type.Boolean(),
  is_fallback: Type.Boolean(),
  selected_model: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  masked_key: Type.String(),
})

export const ProviderPresetsResponseSchema = Type.Object({
  presets: Type.Array(Type.Record(Type.String(), Type.Unknown())),
})

export type ProviderConfigRequest = Static<typeof ProviderConfigRequestSchema>
export type FetchModelsResponse = Static<typeof FetchModelsResponseSchema>
export type TestConnectionResponse = Static<typeof TestConnectionResponseSchema>
export type ActiveProviderInfo = Static<typeof ActiveProviderInfoSchema>
export type ProviderPresetsResponse = Static<typeof ProviderPresetsResponseSchema>
