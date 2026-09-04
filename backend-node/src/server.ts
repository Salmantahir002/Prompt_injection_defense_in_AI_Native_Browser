import { buildApp } from './app.js'
import { settings } from './config/env.js'

async function main(): Promise<void> {
  const app = await buildApp()

  try {
    await app.listen({ port: settings.PORT, host: '127.0.0.1' })
    app.log.info(`Launching ${settings.APP_NAME} on http://127.0.0.1:${settings.PORT}`)
    app.log.info(`API available at ${settings.API_V1_PREFIX}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down PromptGuard Backend Application...`)
    await app.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

void main()
