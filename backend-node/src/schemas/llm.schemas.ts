// Port of backend/app/schemas/llm_schemas.py.
import { Type, type Static } from '@sinclair/typebox'

export const LlmHistoryMessageSchema = Type.Object({
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant'), Type.Literal('system')]),
  content: Type.String(),
})

export const LlmChatRequestSchema = Type.Object({
  prompt: Type.String(),
  security_check_id: Type.Optional(Type.String()),
  page_url: Type.Optional(Type.String()),
  page_title: Type.Optional(Type.String()),
  page_content: Type.Optional(Type.String()),
  history: Type.Optional(Type.Array(LlmHistoryMessageSchema)),
})

export const LlmUsageSchema = Type.Object({
  prompt_tokens: Type.Integer(),
  completion_tokens: Type.Integer(),
})

export const LlmChatResponseSchema = Type.Object({
  response: Type.String(),
  model: Type.String(),
  usage: LlmUsageSchema,
})

export type LlmChatRequest = Static<typeof LlmChatRequestSchema>
export type LlmChatResponse = Static<typeof LlmChatResponseSchema>
