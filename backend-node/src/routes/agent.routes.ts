// Port of backend/app/api/v1/agent_routes.py.
//
// Reserved exclusively for the autonomous agent runtime. The user-initiated
// "Scan Page" button uses POST /security/check-webpage and must never reach
// this router — separate routes, schemas, aggregation, and event logs so
// neither can regress the other (test_agent_security_route.py enforces this
// in both directions).
import type { FastifyInstance } from 'fastify'
import { settings } from '../config/env.js'
import { agentPlannerService } from '../services/agentPlannerService.js'
import { agentSecurityEventStore } from '../services/agentSecurityEventStore.js'
import { agentSecurityService } from '../services/agentSecurityService.js'
import { ToolValidationError, allTools, requiresApproval } from '../services/agentToolRegistry.js'
import { MANUAL_SCAN_CHANNELS } from './security.routes.js'
import {
  AgentPlanRequestSchema,
  AgentPlanResponseSchema,
  AgentScanRequestSchema,
  AgentScanResponseSchema,
  type AgentPageSnapshot,
  type AgentPlanRequest,
} from '../schemas/agent.schemas.js'
import { ErrorResponseSchema } from '../schemas/common.js'

// Held as its own export so the agent scanner can never independently drift
// from the manual scanner's channel list — reusing the same array (rather
// than redeclaring an "identical" copy, as the Python pair does) makes
// disagreement structurally impossible instead of merely tested-against.
// See MANUAL_SCAN_CHANNELS in security.routes.ts and
// test_agent_and_manual_scan_agree.py for why this must hold.
export const AGENT_SCAN_CHANNELS = MANUAL_SCAN_CHANNELS

export default async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AgentPlanRequest }>(
    '/agent/plan',
    {
      schema: {
        body: AgentPlanRequestSchema,
        response: {
          200: AgentPlanResponseSchema,
          400: ErrorResponseSchema,
          422: ErrorResponseSchema,
          502: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const goal = request.body.goal.trim()
      if (!goal) {
        return reply.code(400).send({ detail: 'Agent goal cannot be empty.' })
      }

      if (!agentPlannerService.isConfigured) {
        // A placeholder plan would be a fabricated instruction to drive a real
        // browser, so refuse outright rather than inventing an action.
        return reply.code(503).send({
          detail:
            'Agent planner unavailable: no LLM provider is active. ' +
            'Connect and activate a provider in Settings to enable autonomous planning.',
        })
      }

      const memory = request.body.working_memory ?? {}
      const pageState = request.body.page_state ?? {}

      let actions: Array<[string, Record<string, unknown>]>
      let confidence: number
      let reason: string
      try {
        ;[actions, confidence, reason] = await agentPlannerService.requestPlan(goal, memory, pageState)
      } catch (exc) {
        if (exc instanceof ToolValidationError) {
          // The model produced something we will not execute. Surfaced as 422
          // so the runtime can retry or replan rather than treating it as an outage.
          app.log.warn(`Planner produced an invalid tool call: ${exc.message}`)
          return reply.code(422).send({ detail: `Planner produced an invalid tool call: ${exc.message}` })
        }
        const message = exc instanceof Error ? exc.message : String(exc)
        app.log.warn(`Planner LLM execution error: ${message}`)
        return reply.code(502).send({ detail: `Planner LLM provider error: ${message}` })
      }

      const toolCalls = actions.map(([name, args]) => ({
        tool: name,
        arguments: args,
        requires_approval: requiresApproval(name),
      }))

      return {
        tool_calls: toolCalls,
        tool_call: toolCalls[0]!,
        confidence,
        needs_user_confirmation: confidence < settings.AGENT_MIN_CONFIDENCE,
        reason,
        model: agentPlannerService.model,
        planner_mode: 'llm' as const,
      }
    },
  )

  app.post('/agent/scan-active-page', {
    schema: { body: AgentScanRequestSchema, response: { 200: AgentScanResponseSchema, 400: ErrorResponseSchema } },
  }, async (request, reply) => {
    const body = request.body as { task_id: string; url?: string; page_hash?: string; snapshot: AgentPageSnapshot }
    if (!body.task_id.trim()) {
      return reply.code(400).send({ detail: 'A task_id is required for agent scans.' })
    }

    const snapshot = body.snapshot
    const sources: Array<[string, string]> = AGENT_SCAN_CHANNELS.map(
      (name) => [name, (snapshot as Record<string, string | undefined>)[name] ?? ''] as [string, string],
    )

    if (!sources.some(([, text]) => text.trim().length > 0)) {
      // An empty capture is not evidence of safety. Refuse rather than
      // returning allowed=true, which would let the agent act unscanned.
      return reply.code(400).send({ detail: 'Agent page snapshot was empty; cannot certify the page as safe.' })
    }

    const result = await agentSecurityService.scanSources(sources)
    const url = body.url || snapshot.url || ''

    agentSecurityEventStore.addEvent(
      body.task_id,
      url,
      result.allowed,
      result.risk_level,
      result.summary_reason,
      result.blocked_sources,
    )

    if (!result.allowed) {
      app.log.warn(`[agent-security] Task ${body.task_id} blocked at ${url} — ${result.summary_reason}`)
    }

    return {
      task_id: body.task_id,
      url,
      page_hash: body.page_hash ?? '',
      scanned_at: new Date().toISOString(),
      ...result,
    }
  })

  app.get('/agent/security/events', async (request) => {
    const { task_id: taskId } = request.query as { task_id?: string }
    return agentSecurityEventStore.getEvents(taskId)
  })

  // Introspection for the UI: what the planner is currently allowed to do.
  app.get('/agent/tools', async () =>
    allTools().map((spec) => ({
      name: spec.name,
      description: spec.description,
      category: spec.category,
      requires_approval: spec.requiresApproval,
      handled_by_loop: spec.handledByLoop,
      parameters: spec.parameters.map((p) => ({
        name: p.name,
        kind: p.kind,
        required: p.required,
        description: p.description,
      })),
    })),
  )
}
