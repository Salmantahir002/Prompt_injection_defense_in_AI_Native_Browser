import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AgentTask } from '../services/agentRuntimeCore'
import type { ApprovalRequest } from '../services/agentApprovalPolicy'
import type { AgentTaskResult, AgentToolCall } from '../types/agentTypes'
import { PromptModelPicker } from './PromptModelPicker'

type StepEntry = {
  id: string
  step: number
  tool: string
  detail: string
}

type AgentModePanelProps = {
  /** Browser Runtime target id for the active tab; null before it attaches. */
  targetId: number | null
  currentUrl: string
  /**
   * Opens a new tab for the agent's `open_tab` tool and resolves to its target
   * id. Omitted means the app cannot open tabs, and the tool is refused.
   */
  onOpenTab?: (url?: string) => Promise<number | null>
  onOpenSettings?: () => void
}

function describeArguments(toolCall: AgentToolCall): string {
  const args = toolCall.arguments ?? {}
  return ['target', 'url', 'value', 'text', 'key', 'note', 'summary']
    .filter((name) => typeof args[name] === 'string' && args[name])
    .map((name) => String(args[name]).slice(0, 80))
    .join(' · ')
}

export function AgentModePanel({ targetId, currentUrl, onOpenTab, onOpenSettings }: AgentModePanelProps) {
  const [goal, setGoal] = useState('')
  const [activeGoal, setActiveGoal] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [steps, setSteps] = useState<StepEntry[]>([])
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<AgentTaskResult | null>(null)
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)



  const abortRef = useRef<AbortController | null>(null)
  const approvalResolverRef = useRef<((granted: boolean) => void) | null>(null)
  const stepsEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [steps, approval, result])

  // A pending approval must not outlive the panel, or the task would wait for
  // an answer that can no longer be given.
  useEffect(() => () => {
    approvalResolverRef.current?.(false)
    abortRef.current?.abort()
  }, [])

  const handleApprovalRequest = useCallback((request: ApprovalRequest) => {
    setApproval(request)
    return new Promise<boolean>((resolve) => {
      approvalResolverRef.current = (granted: boolean) => {
        approvalResolverRef.current = null
        setApproval(null)
        resolve(granted)
      }
    })
  }, [])

  const answerApproval = useCallback((granted: boolean) => {
    approvalResolverRef.current?.(granted)
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedGoal = goal.trim()
    if (!trimmedGoal || isRunning) return

    if (targetId === null) {
      setStatus('The browser view is not ready yet. Open a page first.')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller

    setIsRunning(true)
    setSteps([])
    setResult(null)
    setActiveGoal(trimmedGoal)
    setGoal('')
    setStatus('Planning the first action…')

    const task = new AgentTask({
      taskId: `task-${Date.now()}`,
      goal: trimmedGoal,
      targetId,
      visualFeedback: true,
      signal: controller.signal,
      onApprovalRequest: handleApprovalRequest,
      onOpenTab,
      events: {
        onStatus: (message) => setStatus(message),
        onStep: (step, toolCall) => {
          setSteps((previous) => [...previous, {
            id: `${step}-${toolCall.tool}-${previous.length}`,
            step,
            tool: toolCall.tool,
            detail: describeArguments(toolCall),
          }])
          setStatus(`Running ${toolCall.tool}…`)
        },
      },
    })

    try {
      setResult(await task.run())
    } catch (error) {
      setResult({
        taskId: 'unknown',
        status: 'failed',
        message: error instanceof Error ? error.message : 'The agent stopped unexpectedly.',
        steps: 0,
      })
    } finally {
      setIsRunning(false)
      setStatus('')
      abortRef.current = null
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    approvalResolverRef.current?.(false)
    setStatus('Stopping…')
  }

  const hasPage = Boolean(currentUrl) && currentUrl !== 'about:blank'

  const resultTone = result?.status === 'completed'
    ? 'agent-result--ok'
    : 'agent-result--failed'

  return (
    <div className="agent-mode" aria-label="Agent mode">
      {steps.length === 0 && !result && !isRunning ? (
        <div className="agent-intro">
          <h3>Agent mode</h3>
          <p>
            Give the agent a goal and it will operate this tab for you.
            Use the toolbar Scan Page button to check any page for hidden instructions.
          </p>
          {status ? <p className="agent-intro-hint">{status}</p> : hasPage ? null : <p className="agent-intro-hint">Open a page to begin.</p>}
        </div>
      ) : (
        <div className="agent-timeline">
          {activeGoal ? <div className="agent-goal-bubble">{activeGoal}</div> : null}

          {steps.map((entry) => (
            <div className="agent-step" key={entry.id}>
              <span className="agent-step-index">{entry.step}</span>
              <div className="agent-step-body">
                <span className="agent-step-tool">{entry.tool}</span>
                {entry.detail ? <span className="agent-step-detail">{entry.detail}</span> : null}
              </div>
            </div>
          ))}

          {isRunning && status ? (
            <div className="agent-status">
              {status}
              <div className="dot-pulse"><span /><span /><span /></div>
            </div>
          ) : null}

          {result ? (
            <div className={`agent-result ${resultTone}`} role="status">
              <strong>
                {result.status === 'completed' ? 'Done' : 'Stopped'}
              </strong>
              <p>{result.message}</p>
              <span className="agent-result-steps">{result.steps} step{result.steps === 1 ? '' : 's'}</span>
            </div>
          ) : null}

          <div ref={stepsEndRef} />
        </div>
      )}

      {approval ? (
        <div className="agent-approval" role="alertdialog" aria-label="Approval required">
          <strong>Approve this action?</strong>
          <p className="agent-approval-summary">{approval.summary}</p>
          <p className="agent-approval-reason">{approval.reason}</p>
          <div className="agent-approval-actions">
            <button type="button" className="agent-approve" onClick={() => answerApproval(true)}>
              Allow
            </button>
            <button type="button" className="agent-decline" onClick={() => answerApproval(false)}>
              Don't allow
            </button>
          </div>
        </div>
      ) : null}

      {/* The goal box and its button share one framed composer so the button
          can never drift out of alignment as the textarea grows. */}
      <form className="agent-goal-form" onSubmit={handleSubmit}>
        <textarea
          className="agent-goal-input"
          aria-label="Agent goal"
          placeholder="What should the agent do on this page?"
          rows={2}
          value={goal}
          disabled={isRunning}
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <div className="agent-goal-footer">
          <div className="agent-goal-footer-left">
            <PromptModelPicker onOpenSettings={onOpenSettings} />
            <span className="agent-goal-hint">{isRunning ? 'Running…' : 'Enter to run'}</span>
          </div>
          {isRunning ? (
            <button type="button" className="agent-stop-button" onClick={handleStop}>Stop</button>
          ) : (
            <button type="submit" className="agent-run-button" disabled={!goal.trim()}>Run</button>
          )}
        </div>
      </form>

    </div>
  )
}
