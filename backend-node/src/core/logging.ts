import type { FastifyServerOptions } from 'fastify'
import { settings } from '../config/env.js'

// Mirrors logging_config.py: DEBUG in development, INFO otherwise, single stdout stream.
const level = settings.APP_ENV === 'development' ? 'debug' : 'info'

export const fastifyLoggerOptions: FastifyServerOptions['logger'] = {
  level,
  transport:
    settings.APP_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
      : undefined,
}
