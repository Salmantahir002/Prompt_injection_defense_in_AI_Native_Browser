import type { FastifyInstance } from 'fastify'
import os from 'node:os'
import process from 'node:process'
import { promptClassifier } from '../services/promptClassifierService.js'

// Mirrors health_routes.py: status/version plus the live classifier mode and the
// backend runtime versions surfaced in the Electron DevTools console banner.
export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'healthy',
    version: '1.0.0',
    model_loaded: promptClassifier.modelLoaded,
    classifier_mode: promptClassifier.classifierMode,
    runtime: {
      node: process.version,
      node_implementation: `Node.js (${process.version})`,
      fastify: app.version,
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
    },
  }))
}
