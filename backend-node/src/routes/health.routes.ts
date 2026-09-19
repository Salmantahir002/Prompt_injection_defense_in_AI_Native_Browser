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
    // 'fp32' whenever the DL model is active: the unquantized graph is a
    // deliberate accuracy-over-speed choice and should be visible externally.
    model_precision: promptClassifier.modelPrecision,
    runtime: {
      node: process.version,
      node_implementation: `Node.js (${process.version})`,
      fastify: app.version,
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
    },
  }))
}
