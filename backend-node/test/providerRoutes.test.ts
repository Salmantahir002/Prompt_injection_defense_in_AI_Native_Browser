// Port of backend/app/tests/test_provider_routes.py — /api/v1/providers/*.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { llmProviderManager } from '../src/services/llmProviderManager.js'

const PREFIX = '/api/v1'
let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})
afterAll(async () => {
  await app.close()
})
afterEach(() => {
  vi.restoreAllMocks()
  llmProviderManager.clearActiveProvider()
})

it('GET /providers/presets returns the 12 presets in order', async () => {
  const res = await app.inject({ method: 'GET', url: `${PREFIX}/providers/presets` })
  expect(res.statusCode).toBe(200)
  const data = res.json() as { presets: Array<{ id: string }> }
  expect(data.presets).toHaveLength(12)
  expect(data.presets.map((p) => p.id)).toEqual([
    'opencode',
    'gemini',
    'anthropic',
    'openai',
    'nvidia',
    'agentrouter',
    'cloudflare',
    'openrouter',
    'tokenrouter',
    'nararouter',
    'openadapter',
    'custom',
  ])
})

it('POST /providers/models rejects an empty api key', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `${PREFIX}/providers/models`,
    payload: { id: 'openai', name: 'OpenAI', api_key: '' },
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().detail).toContain('API key is required')
})

it('POST /providers/models returns models on success', async () => {
  vi.spyOn(llmProviderManager, 'listModelsForConfig').mockResolvedValue([
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  ])

  const res = await app.inject({
    method: 'POST',
    url: `${PREFIX}/providers/models`,
    payload: { id: 'openai', name: 'OpenAI', api_key: 'sk-mock-key' },
  })
  expect(res.statusCode).toBe(200)
  const data = res.json()
  expect(data.provider_id).toBe('openai')
  expect(data.models).toHaveLength(2)
  expect(data.count).toBe(2)
})

it('POST /providers/test reports the connection result', async () => {
  vi.spyOn(llmProviderManager, 'testConnection').mockResolvedValue({
    success: true,
    latency_ms: 42.5,
    models_count: 10,
    models: [{ id: 'm1', name: 'Model 1' }],
    message: 'Connected successfully',
  })

  const res = await app.inject({
    method: 'POST',
    url: `${PREFIX}/providers/test`,
    payload: { id: 'anthropic', name: 'Anthropic', api_key: 'sk-ant-test' },
  })
  expect(res.statusCode).toBe(200)
  const data = res.json()
  expect(data.success).toBe(true)
  expect(data.latency_ms).toBe(42.5)
  expect(data.models_count).toBe(10)
})

describe('active provider lifecycle', () => {
  it('set, get, then clear', async () => {
    const setRes = await app.inject({
      method: 'POST',
      url: `${PREFIX}/providers/active`,
      payload: { id: 'openai', name: 'OpenAI', api_key: 'sk-1234567890abcdef', selected_model: 'gpt-4o' },
    })
    expect(setRes.statusCode).toBe(200)
    const setData = setRes.json()
    expect(setData.id).toBe('openai')
    expect(setData.is_active).toBe(true)
    expect(setData.selected_model).toBe('gpt-4o')
    expect(setData.masked_key).toContain('••••')

    const getRes = await app.inject({ method: 'GET', url: `${PREFIX}/providers/active` })
    expect(getRes.statusCode).toBe(200)
    expect(getRes.json().id).toBe('openai')
    expect(getRes.json().selected_model).toBe('gpt-4o')

    const delRes = await app.inject({ method: 'DELETE', url: `${PREFIX}/providers/active` })
    expect(delRes.statusCode).toBe(200)
    const delData = delRes.json()
    expect(delData.is_active).toBe(false)
    expect(delData.is_fallback).toBe(false)
    expect(delData.id).toBe('')
  })
})
