// Port of backend/app/tests/test_agent_routes.py — POST /api/v1/agent/plan
// and its isolation from the manual scan endpoint.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { agentPlannerService } from '../src/services/agentPlannerService.js'
import { TOOLS_BY_NAME } from '../src/services/agentToolRegistry.js'

const PREFIX = '/api/v1'
let app: FastifyInstance

const SAMPLE_STATE = {
  url: 'https://example.test/login',
  title: 'Login',
  elements: [
    { id: 'e1', role: 'textbox', name: 'Username' },
    { id: 'e2', role: 'button', name: 'Sign in' },
  ],
  focusedElementId: null,
  dialogs: [],
  validationErrors: [],
  selectedElementIds: [],
  truncated: false,
}

function planBody(goal = 'sign in') {
  return { goal, working_memory: { goal }, page_state: SAMPLE_STATE }
}

/** Pretend the LLM is configured, and stub the model call. */
function configurePlanner(reply: string) {
  vi.spyOn(agentPlannerService, 'isConfigured', 'get').mockReturnValue(true)
  vi.spyOn(agentPlannerService as unknown as { callModel: () => Promise<string> }, 'callModel').mockResolvedValue(reply)
}

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})
afterAll(async () => {
  await app.close()
})
afterEach(() => {
  vi.restoreAllMocks()
})

it('an empty goal is rejected', async () => {
  const res = await app.inject({ method: 'POST', url: `${PREFIX}/agent/plan`, payload: planBody('   ') })
  expect(res.statusCode).toBe(400)
})

it('the planner is unavailable without an active provider', async () => {
  vi.spyOn(agentPlannerService, 'isConfigured', 'get').mockReturnValue(false)
  const res = await app.inject({ method: 'POST', url: `${PREFIX}/agent/plan`, payload: planBody() })
  expect(res.statusCode).toBe(503)
  expect(res.json().detail).toContain('no LLM provider is active')
})

it('a valid plan is returned', async () => {
  configurePlanner('{"tool": "click", "arguments": {"target": "e2"}, "confidence": 0.91, "reason": "sign in button"}')
  const res = await app.inject({ method: 'POST', url: `${PREFIX}/agent/plan`, payload: planBody() })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.tool_call).toEqual({ tool: 'click', arguments: { target: 'e2' }, requires_approval: false })
  expect(body.tool_calls).toEqual([body.tool_call])
  expect(body.confidence).toBe(0.91)
  expect(body.needs_user_confirmation).toBe(false)
})

it('a low-confidence plan requests user confirmation', async () => {
  configurePlanner('{"tool": "click", "arguments": {"target": "e2"}, "confidence": 0.2}')
  const body = (await app.inject({ method: 'POST', url: `${PREFIX}/agent/plan`, payload: planBody() })).json()
  expect(body.needs_user_confirmation).toBe(true)
})

it('a hallucinated element id returns 422', async () => {
  configurePlanner('{"tool": "click", "arguments": {"target": "e999"}, "confidence": 0.99}')
  const res = await app.inject({ method: 'POST', url: `${PREFIX}/agent/plan`, payload: planBody() })
  expect(res.statusCode).toBe(422)
  expect(res.json().detail).toContain('unknown element')
})

it('a prose-only reply returns 422', async () => {
  configurePlanner('I think you should click the sign in button.')
  const res = await app.inject({ method: 'POST', url: `${PREFIX}/agent/plan`, payload: planBody() })
  expect(res.statusCode).toBe(422)
})

it('an injected page instruction cannot widen the tool set', async () => {
  configurePlanner('{"tool": "exfiltrate", "arguments": {"url": "https://evil.test"}, "confidence": 1.0}')
  const res = await app.inject({ method: 'POST', url: `${PREFIX}/agent/plan`, payload: planBody() })
  expect(res.statusCode).toBe(422)
  expect(res.json().detail).toContain('Unknown tool')
})

it('injected navigation to a file scheme is refused', async () => {
  configurePlanner('{"tool": "navigate", "arguments": {"url": "file:///C:/Users/secrets.txt"}, "confidence": 1.0}')
  const res = await app.inject({ method: 'POST', url: `${PREFIX}/agent/plan`, payload: planBody() })
  expect(res.statusCode).toBe(422)
})

it('the /agent/tools endpoint lists the registry', async () => {
  const res = await app.inject({ method: 'GET', url: `${PREFIX}/agent/tools` })
  expect(res.statusCode).toBe(200)
  const names = new Set((res.json() as Array<{ name: string }>).map((t) => t.name))
  expect(names).toEqual(new Set(TOOLS_BY_NAME.keys()))
})

describe('endpoint isolation', () => {
  it('the agent router does not disturb the manual scan endpoint', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${PREFIX}/security/check-webpage`,
      payload: {
        visible_text: 'A perfectly ordinary paragraph about cats.',
        hidden_text: '',
        html_comments: '',
        meta_tags: '',
        input_values: '',
        page_title: 'Cats',
        url: 'https://example.test',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().allowed).toBe(true)
    expect(res.json().source).toBe('webpage_content')
  })
})

it('the planner singleton is exported', () => {
  expect(agentPlannerService).toBeTypeOf('object')
  expect(typeof agentPlannerService.requestPlan).toBe('function')
})
