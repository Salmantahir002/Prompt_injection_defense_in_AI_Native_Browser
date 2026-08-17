import type {
  AgentScanDecision,
  AgentTaskResult,
  AgentToolCall,
} from '../types/agentTypes'
import type { CircuitBreakerState } from './agentCircuitBreaker'
import type { ApprovalHandler } from './agentApprovalPolicy'

export type AgentTaskEvents = {
  onStep?: (step: number, toolCall: AgentToolCall, decision: AgentScanDecision) => void
  onSecurityBlock?: (state: CircuitBreakerState) => void
  onStatus?: (message: string) => void
}

export type AgentTaskOptions = {
  taskId: string
  goal: string
  targetId: number
  maxSteps?: number
  signal?: AbortSignal
  events?: AgentTaskEvents
  visualFeedback?: boolean
  onApprovalRequest?: ApprovalHandler
  onOpenTab?: (url?: string) => Promise<number | null>
}

export class AgentTask {
  readonly taskId: string
  readonly goal: string
  private targetId: number
  private readonly signal?: AbortSignal
  private readonly events: AgentTaskEvents
  private readonly visualFeedback: boolean
  private readonly onOpenTab?: (url?: string) => Promise<number | null>

  constructor(options: AgentTaskOptions) {
    this.taskId = options.taskId
    this.goal = options.goal.trim()
    this.targetId = options.targetId
    this.signal = options.signal
    this.events = options.events ?? {}
    this.visualFeedback = options.visualFeedback !== false
    this.onOpenTab = options.onOpenTab
  }

  async run(): Promise<AgentTaskResult> {
    const api = window.electronAPI
    if (!api || !api.agentStartTask) {
      return {
        taskId: this.taskId,
        status: 'failed',
        message: 'Electron Agent Runtime is not available in this environment.',
        steps: 0,
      }
    }

    return new Promise<AgentTaskResult>((resolve) => {
      let unsubscribe: (() => void) | null = null
      let unsubscribeTab: (() => void) | null = null

      const cleanup = () => {
        if (unsubscribe) {
          unsubscribe()
          unsubscribe = null
        }
        if (unsubscribeTab) {
          unsubscribeTab()
          unsubscribeTab = null
        }
      }

      if (this.signal) {
        this.signal.addEventListener('abort', () => {
          api.agentStopTask(this.taskId).catch(() => undefined)
        })
      }

      unsubscribe = api.onAgentEvent((data: any) => {
        if (data.taskId !== this.taskId) return

        if (data.type === 'status' && typeof data.payload === 'string') {
          this.events.onStatus?.(data.payload)
        } else if (data.type === 'step' && data.payload) {
          const { step, toolCall, decision } = data.payload
          this.events.onStep?.(step, toolCall, decision)
        } else if (data.type === 'security_block' && data.payload) {
          this.events.onSecurityBlock?.(data.payload)
        } else if (data.type === 'result' && data.payload) {
          cleanup()
          resolve(data.payload as AgentTaskResult)
        }
      })

      if (api.onAgentRequestOpenTab && this.onOpenTab) {
        unsubscribeTab = api.onAgentRequestOpenTab(async (data) => {
          if (data.taskId !== this.taskId) return
          try {
            const newTargetId = await this.onOpenTab!(data.url)
            await api.agentResponseOpenTab({ requestId: data.requestId, targetId: newTargetId })
          } catch {
            await api.agentResponseOpenTab({ requestId: data.requestId, targetId: null })
          }
        })
      }

      api.agentStartTask({
        taskId: this.taskId,
        goal: this.goal,
        targetId: this.targetId,
        visualFeedback: this.visualFeedback,
      }).then((startRes) => {
        if (!startRes.ok) {
          cleanup()
          resolve({
            taskId: this.taskId,
            status: 'failed',
            message: startRes.error || 'Failed to start agent task.',
            steps: 0,
          })
        }
      }).catch((err) => {
        cleanup()
        resolve({
          taskId: this.taskId,
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
          steps: 0,
        })
      })
    })
  }
}
