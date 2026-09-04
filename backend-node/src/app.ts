import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { settings } from './config/env.js'
import { fastifyLoggerOptions } from './core/logging.js'
import healthRoutes from './routes/health.routes.js'
import securityRoutes from './routes/security.routes.js'
import agentRoutes from './routes/agent.routes.js'
import llmRoutes from './routes/llm.routes.js'
import providerRoutes from './routes/providers.routes.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: fastifyLoggerOptions })

  await app.register(cors, {
    origin: settings.CORS_ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  // FastAPI parity: every error body is {"detail": "<message>"} (see ErrorResponseSchema).
  // Without this, a request that fails body-schema validation hits Fastify's default
  // {statusCode,error,message} shape, which then fails to serialize against a route's
  // 400 response schema (detail is required) and surfaces as a 500. Request-schema
  // violations map to 422, matching FastAPI's RequestValidationError.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return reply.code(422).send({ detail: error.message })
    }
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500
    if (status >= 500) {
      request.log.error({ err: error }, 'Unhandled error')
      return reply.code(status).send({ detail: 'Internal Server Error' })
    }
    return reply.code(status).send({ detail: error.message })
  })

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ detail: 'Not Found' })
  })

  await app.register(healthRoutes, { prefix: settings.API_V1_PREFIX })
  await app.register(securityRoutes, { prefix: settings.API_V1_PREFIX })
  await app.register(agentRoutes, { prefix: settings.API_V1_PREFIX })
  await app.register(llmRoutes, { prefix: settings.API_V1_PREFIX })
  await app.register(providerRoutes, { prefix: settings.API_V1_PREFIX })

  return app
}
