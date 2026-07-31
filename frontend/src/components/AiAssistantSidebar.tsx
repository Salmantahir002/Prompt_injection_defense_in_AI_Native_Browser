import { useRef, useState, useEffect } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { checkPrompt, chatWithLlm } from '../services/backendApiClient'
import type { AnalysisDetails } from '../types/analysisDetailsTypes'
import type { LlmResponse, SecurityCheckResponse } from '../types/securityTypes'
import { AgentModePanel } from './AgentModePanel'
import { KimoMascot } from './KimoMascot'
import { MarkdownMessage } from './MarkdownMessage'
import { PromptInputBox } from './PromptInputBox'

type SidebarMode = 'chat' | 'agent'

type ChatMessage = {
  id: string
  sender: 'user' | 'assistant'
  text?: string
  securityResult?: SecurityCheckResponse
  llmResponse?: LlmResponse
  errorMessage?: string
  isChecking?: boolean
}

type AiAssistantSidebarProps = {
  onViewDetails?: (details: AnalysisDetails) => void
  /** Browser Runtime target id for the active tab, for agent mode. */
  activeTargetId?: number | null
  currentUrl?: string
  /** Opens a tab for the agent's `open_tab` tool; resolves to its target id. */
  onOpenTab?: (url?: string) => Promise<number | null>
  /** Current panel width in px; owned by the shell, which sets the grid column. */
  width?: number
  onWidthChange?: (width: number) => void
  /** Raised while the edge is being dragged so the shell can shield the webview. */
  onResizingChange?: (isResizing: boolean) => void
}

/** Keyboard nudge per arrow press on the resize separator. */
const RESIZE_STEP = 24

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 12 15 16 10" />
    </svg>
  )
}

function ShieldXIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  )
}

function NewSessionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
      <path d="M18.4 3.6a1.98 1.98 0 0 1 2.8 2.8L12.7 15l-3.5.7.7-3.5 8.5-8.6z" />
    </svg>
  )
}

export function AiAssistantSidebar({
  onViewDetails,
  activeTargetId = null,
  currentUrl = '',
  onOpenTab,
  width = 400,
  onWidthChange,
  onResizingChange,
}: AiAssistantSidebarProps) {
  const [mode, setMode] = useState<SidebarMode>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isChecking, setIsChecking] = useState(false)
  // Bumped to remount the agent panel, which is how "new task" discards a
  // running task and its transcript in one step.
  const [agentSessionId, setAgentSessionId] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const prevMsgCountRef = useRef<number>(0)
  const [clearSignal, setClearSignal] = useState(0)

  useEffect(() => {
    const nextCount = messages.length
    const prevCount = prevMsgCountRef.current
    prevMsgCountRef.current = nextCount

    // Only keep the view pinned when a new message is appended.
    // Avoid smooth scrolling on internal state transitions (checking -> result) which can cause input to jump.
    if (nextCount > prevCount) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
  }, [messages])

  async function handlePromptSubmit(prompt: string) {
    const userMsgId = `user-${Date.now()}`
    const assistantMsgId = `assistant-${Date.now()}`

    // Add user message
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, sender: 'user', text: prompt },
      { id: assistantMsgId, sender: 'assistant', isChecking: true },
    ])

    setIsChecking(true)
    // Trigger PromptInputBox clear immediately when submit starts.
    setClearSignal((v) => v + 1)

    try {
      const result = await checkPrompt(prompt)

      let llmResp: LlmResponse | undefined
      if (result.allowed) {
        llmResp = await chatWithLlm(prompt)
      }

      // Update assistant message with result
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, isChecking: false, securityResult: result, llmResponse: llmResp }
            : msg,
        ),
      )
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
              ...msg,
              isChecking: false,
              errorMessage: error instanceof Error ? error.message : 'Security check failed',
            }
            : msg,
        ),
      )
    } finally {
      setIsChecking(false)
    }
  }

  /** Starts a fresh session in whichever surface is currently showing. */
  function handleNewSession() {
    if (mode === 'chat') {
      setMessages([])
      setIsChecking(false)
      setClearSignal((v) => v + 1)
      return
    }
    setAgentSessionId((id) => id + 1)
  }

  // The drag is tracked on the handle itself via pointer capture: without it
  // the pointer crosses into the Electron <webview>, whose guest process would
  // swallow the move events and strand the drag.
  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()

    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    onResizingChange?.(true)

    const handleMove = (moveEvent: PointerEvent) => {
      onWidthChange?.(window.innerWidth - moveEvent.clientX)
    }
    const handleEnd = () => {
      handle.removeEventListener('pointermove', handleMove)
      handle.removeEventListener('pointerup', handleEnd)
      handle.removeEventListener('pointercancel', handleEnd)
      onResizingChange?.(false)
    }

    handle.addEventListener('pointermove', handleMove)
    handle.addEventListener('pointerup', handleEnd)
    handle.addEventListener('pointercancel', handleEnd)
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onWidthChange?.(width + RESIZE_STEP)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onWidthChange?.(width - RESIZE_STEP)
    }
  }

  const hasMessages = messages.length > 0
  const canStartNewSession = mode === 'agent' || hasMessages || isChecking

  return (
    <aside className="assistant-panel" aria-label="Kimo panel">
      {/* Drag edge. `separator` + arrow keys keeps the panel resizable without
          a pointer. */}
      <div
        className="assistant-resize-handle"
        role="separator"
        aria-label="Resize assistant panel"
        aria-orientation="vertical"
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={handleResizePointerDown}
        onKeyDown={handleResizeKeyDown}
      />
      {/* Header */}
      <div className="assistant-header">
        <div className="assistant-header-left">
          <div className="assistant-logo">
            <KimoMascot compact />
          </div>
          <h2>Kimo</h2>
        </div>
        <div className="assistant-header-right">
          {/* Chat and agent mode are separate surfaces on purpose: one answers
              questions, the other operates the browser. */}
          <div className="assistant-mode-switch" role="tablist" aria-label="Assistant mode">
            <button
              className={`assistant-mode-tab ${mode === 'chat' ? 'assistant-mode-tab--active' : ''}`}
              type="button"
              role="tab"
              aria-selected={mode === 'chat'}
              onClick={() => setMode('chat')}
            >
              Chat
            </button>
            <button
              className={`assistant-mode-tab ${mode === 'agent' ? 'assistant-mode-tab--active' : ''}`}
              type="button"
              role="tab"
              aria-selected={mode === 'agent'}
              onClick={() => setMode('agent')}
            >
              Agent
            </button>
          </div>

          <span className="assistant-header-divider" aria-hidden="true" />

          {/* One button, scoped to the visible surface: the other mode's session
              is left untouched behind it. */}
          <button
            className="assistant-new-button"
            type="button"
            disabled={!canStartNewSession}
            title={mode === 'chat' ? 'New chat' : 'New agent task'}
            aria-label={mode === 'chat' ? 'New chat' : 'New agent task'}
            onClick={handleNewSession}
          >
            <NewSessionIcon />
          </button>
        </div>
      </div>

      {/* Agent mode stays mounted while chat is shown. Unmounting it would
          abort a running task and discard a half-written goal simply because
          the user glanced at the chat tab. */}
      <div className="assistant-pane" hidden={mode !== 'agent'}>
        <AgentModePanel key={agentSessionId} targetId={activeTargetId} currentUrl={currentUrl} onOpenTab={onOpenTab} />
      </div>

      {mode === 'chat' ? (
        <div className="assistant-pane">
      {/* Welcome state or messages */}
      {!hasMessages ? (
        <div className="assistant-welcome">
          <div className="assistant-welcome-header">
            <div className="assistant-welcome-logo">
              <KimoMascot />
            </div>
            <h3>Kimo</h3>
          </div>
          <p>Your prompt-defense assistant. Every message is checked for injection before it reaches the model.</p>
        </div>
      ) : (
        <div className="chat-messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-message chat-message--${msg.sender}`}>
              {msg.sender === 'user' && msg.text ? (
                <div className="chat-bubble chat-bubble--user">{msg.text}</div>
              ) : null}

              {msg.sender === 'assistant' && msg.isChecking ? (
                <div className="chat-checking">
                  <span>Checking for injection</span>
                  <div className="dot-pulse">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ) : null}

              {msg.sender === 'assistant' && msg.errorMessage ? (
                <div className="assistant-error" role="alert">
                  {msg.errorMessage}
                </div>
              ) : null}

              {msg.sender === 'assistant' && msg.securityResult ? (
                <div
                  className={`security-card ${msg.securityResult.allowed ? 'security-card--safe' : 'security-card--blocked'
                    }`}
                >
                  <div className="security-card-header">
                    <span className="security-card-label">
                      {msg.securityResult.allowed ? <ShieldCheckIcon /> : <ShieldXIcon />}
                      {msg.securityResult.allowed ? 'Safe' : 'Blocked'}
                    </span>
                    <span className="security-card-confidence">
                      {Math.round(msg.securityResult.confidence * 100)}%
                    </span>
                  </div>
                  <div className="security-card-body">
                    <div className="security-card-risk">
                      {msg.securityResult.risk_level} risk
                    </div>
                    <p className="security-card-reason">
                      {msg.securityResult.summary_reason}
                    </p>
                  </div>
                  <div className="security-card-footer">
                    <button
                      className="analysis-button"
                      type="button"
                      onClick={() => onViewDetails?.(msg.securityResult!.analysis_details)}
                    >
                      View Prompt Analysis
                    </button>
                  </div>
                </div>
              ) : null}

              {msg.sender === 'assistant' && msg.llmResponse ? (
                <div className="llm-answer">
                  <div className="llm-answer-byline">
                    <span className="llm-answer-avatar">
                      <KimoMascot compact />
                    </span>
                    Kimo
                  </div>
                  {/* The model replies in markdown; rendering it raw would leave
                      `**` and `###` in the transcript. */}
                  <MarkdownMessage text={msg.llmResponse.response} />
                </div>
              ) : null}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input Area */}
      <div className="chat-input-area">
        <PromptInputBox
          disabled={isChecking}
          onSubmit={handlePromptSubmit}
          clearSignal={clearSignal}
        />
      </div>
        </div>
      ) : null}
    </aside>
  )
}
