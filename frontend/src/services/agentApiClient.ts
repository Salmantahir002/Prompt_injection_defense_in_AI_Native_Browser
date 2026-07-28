import type { AgentPlanRequest, AgentPlanResponse } from '../types/agentTypes'
import type { PageStateSnapshot } from '../types/browserRuntimeTypes'
import type { AgentWorkingMemory } from './agentWorkingMemory'

/**
 * Backend client for the autonomous agent runtime.
 *
 * Deliberately separate from `backendApiClient.ts`. The agent subsystem must
 * stay isolated from the manual "Scan Page" and chat flows in routing, request
 * lifecycle, and error handling, so it does not share their transport either.
 */

const AGENT_API_BASE_URL = 'http://127.0.0.1:8000/api/v1'

export type AgentPlanFailure = {
  kind: 'unavailable' | 'invalid_plan' | 'llm_error' | 'network'
  message: string
}

export class AgentPlanError extends Error {
  readonly kind: AgentPlanFailure['kind']

  constructor(kind: AgentPlanFailure['kind'], message: string) {
    super(message)
    this.name = 'AgentPlanError'
    this.kind = kind
  }
}

function classifyStatus(status: number): AgentPlanFailure['kind'] {
  if (status === 503) return 'unavailable'
  if (status === 422) return 'invalid_plan'
  return 'llm_error'
}

/**
 * Asks the planner for the next action.
 *
 * A 422 means the model produced something that failed tool validation — that
 * is a recoverable planning error, not an outage, so it is reported distinctly
 * for the Phase 6 recovery engine to branch on.
 */
export async function requestPlan(
  goal: string,
  memory: AgentWorkingMemory,
  pageState: PageStateSnapshot,
  signal?: AbortSignal,
): Promise<AgentPlanResponse> {
  const body: AgentPlanRequest = {
    goal,
    working_memory: memory.snapshot(),
    page_state: pageState,
  }

  let response: Response
  try {
    response = await fetch(`${AGENT_API_BASE_URL}/agent/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new AgentPlanError('network', 'Agent backend is not reachable.')
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new AgentPlanError(classifyStatus(response.status), detail || `Planner failed with status ${response.status}`)
  }

  return response.json() as Promise<AgentPlanResponse>
}
