// Port of backend/app/api/v1/llm_routes.py — POST /api/v1/llm/chat forwards
// security-approved prompts to the active LLM provider. This endpoint performs
// a final safety gate: the caller is responsible for /security/check-prompt
// first, but a malicious prompt is rejected here too, never forwarded.
import type { FastifyInstance } from 'fastify'
import { ErrorResponseSchema } from '../schemas/common.js'
import { LlmChatRequestSchema, LlmChatResponseSchema, type LlmChatRequest } from '../schemas/llm.schemas.js'
import { llmOpenCodeZenService } from '../services/llmOpenCodeZenService.js'
import { promptClassifier } from '../services/promptClassifierService.js'

export default async function llmRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LlmChatRequest }>(
    '/llm/chat',
    {
      schema: {
        body: LlmChatRequestSchema,
        response: { 200: LlmChatResponseSchema, 400: ErrorResponseSchema, 403: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const { prompt } = request.body
      if (!prompt.trim()) {
        return reply.code(400).send({ detail: 'Prompt cannot be empty.' })
      }

      // Final safety gate — verify the prompt is not malicious.
      const classification = await promptClassifier.classify(prompt)
      if (classification.is_malicious) {
        return reply
          .code(403)
          .send({ detail: 'Prompt blocked by security pipeline. Malicious content detected — not forwarding to LLM.' })
      }

      const result = await llmOpenCodeZenService.chat({
        prompt,
        pageUrl: request.body.page_url,
        pageTitle: request.body.page_title,
        pageContent: request.body.page_content,
      })

      return {
        response: result.response,
        model: result.model,
        usage: result.usage,
      }
    },
  )
}
