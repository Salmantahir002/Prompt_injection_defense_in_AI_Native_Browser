import pino from 'pino'
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

// Standalone logger for code that runs outside a Fastify request (the DL model
// loader boots at import time, before the server instance exists). Same level
// and transport as the server logger so both streams read identically.
export const logger = pino(fastifyLoggerOptions as pino.LoggerOptions)
