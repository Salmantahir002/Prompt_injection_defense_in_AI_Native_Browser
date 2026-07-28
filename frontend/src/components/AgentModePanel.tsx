import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AgentTask } from '../services/agentRuntimeCore'
import type { ApprovalRequest } from '../services/agentApprovalPolicy'
import type { CircuitBreakerState } from '../services/agentCircuitBreaker'
import type { AgentScanDecision, AgentTaskResult, AgentToolCall } from '../types/agentTypes'

/**
 * Agent mode: give the agent a goal and watch it work.
 *
 * The panel deliberately shows the security verdict for every step rather than
 * only when something goes wrong. The whole point of the architecture is that
 * each page is scanned before the agent touches it, and that guarantee is
 * worth nothing to a user who cannot see it happening.
 */

type StepEntry = {
  id: string
  step: number
  tool: string
  detail: string
  scanned: boolean
  fromCache: boolean
}

type AgentModePanelProps = {
  /** Browser Runtime target id for the active tab; null before it attaches. */
  targetId: number | null
  currentUrl: string
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 12 15 16 10" />
    </svg>
  )
}

function describeArguments(toolCall: AgentToolCall): string {
  const args = toolCall.arguments ?? {}
  return ['target', 'url', 'value', 'text', 'key', 'note', 'summary']
    .filter((name) => typeof args[name] === 'string' && args[name])
    .map((name) => String(args[name]).slice(0, 80))
    .join(' · ')
}

export function AgentModePanel({ targetId, currentUrl }: AgentModePanelProps) {
  const [goal, setGoal] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [steps, setSteps] = useState<StepEntry[]>([])
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<AgentTaskResult | null>(null)
  const [blockState, setBlockState] = useState<CircuitBreakerState | null>(null)
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
    setBlockState(null)
    setStatus('Scanning the page and planning the first action…')

    const task = new AgentTask({
      taskId: `task-${Date.now()}`,
      goal: trimmedGoal,
      targetId,
      signal: controller.signal,
      onApprovalRequest: handleApprovalRequest,
      events: {
        onStatus: (message) => setStatus(message),
        onSecurityBlock: (state) => setBlockState(state),
        onStep: (step, toolCall, decision: AgentScanDecision) => {
          setSteps((previous) => [...previous, {
            id: `${step}-${toolCall.tool}-${previous.length}`,
            step,
            tool: toolCall.tool,
            detail: describeArguments(toolCall),
            scanned: Boolean(decision),
            fromCache: Boolean(decision?.fromCache),
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

  const resultTone = result?.status === 'completed'
    ? 'agent-result--ok'
    : result?.status === 'blocked' ? 'agent-result--blocked' : 'agent-result--failed'

  return (
    <div className="agent-mode" aria-label="Agent mode">
      {steps.length === 0 && !result && !isRunning ? (
        <div className="agent-intro">
          <h3>Agent mode</h3>
          <p>
            Give the agent a goal and it will operate this tab for you. Every page
            it reaches is scanned for hidden instructions before it is allowed to act.
          </p>
          <p className="agent-intro-page">{currentUrl && currentUrl !== 'about:blank' ? currentUrl : 'Open a page to begin.'}</p>
        </div>
      ) : (
        <div className="agent-timeline">
          {steps.map((entry) => (
            <div className="agent-step" key={entry.id}>
              <span className="agent-step-index">{entry.step}</span>
              <div className="agent-step-body">
                <span className="agent-step-tool">{entry.tool}</span>
                {entry.detail ? <span className="agent-step-detail">{entry.detail}</span> : null}
              </div>
              {entry.scanned ? (
                <span className="agent-step-scan" title={entry.fromCache ? 'Page unchanged since the last scan' : 'Page scanned before this action'}>
                  <ShieldIcon />
                </span>
              ) : null}
            </div>
          ))}

          {isRunning && status ? (
            <div className="agent-status">
              {status}
              <div className="dot-pulse"><span /><span /><span /></div>
            </div>
          ) : null}

          {blockState ? (
            <div className="agent-block" role="alert">
              <strong>Blocked for your safety</strong>
              <p>{blockState.message}</p>
              {blockState.decision?.blocked_sources?.length ? (
                <p className="agent-block-sources">
                  Found in: {blockState.decision.blocked_sources.join(', ')}
                </p>
              ) : null}
            </div>
          ) : null}

          {result && !blockState ? (
            <div className={`agent-result ${resultTone}`} role="status">
              <strong>
                {result.status === 'completed' ? 'Done' : result.status === 'blocked' ? 'Blocked' : 'Stopped'}
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
        {isRunning ? (
          <button type="button" className="agent-stop-button" onClick={handleStop}>Stop</button>
        ) : (
          <button type="submit" className="agent-run-button" disabled={!goal.trim()}>Run</button>
        )}
      </form>
    </div>
  )
}
