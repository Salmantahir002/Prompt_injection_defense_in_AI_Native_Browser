import { useRef, useState, useEffect } from 'react'
import { checkPrompt, chatWithLlm } from '../services/backendApiClient'
import type { AnalysisDetails } from '../types/analysisDetailsTypes'
import type { LlmResponse, SecurityCheckResponse } from '../types/securityTypes'
import { AgentModePanel } from './AgentModePanel'
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
}

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

/**
 * Kimo, the assistant's mascot: the same friendly screen-faced robot as before,
 * redrawn with squat proportions — a wide head over a short body, no legs — so
 * it reads clearly at 20px in the header as well as full size in the welcome
 * state.
 */
function KimoMascot({ compact = false }: { compact?: boolean }) {
  return (
    <svg className={`kimo-mascot ${compact ? 'kimo-mascot--compact' : ''}`} viewBox="0 0 120 104" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="kimo-case" x1="24" y1="14" x2="96" y2="94" gradientUnits="userSpaceOnUse">
          <stop stopColor="#cfe0ff" />
          <stop offset="0.48" stopColor="#7ea2f8" />
          <stop offset="1" stopColor="#3c56b8" />
        </linearGradient>
        <linearGradient id="kimo-screen" x1="32" y1="26" x2="88" y2="66" gradientUnits="userSpaceOnUse">
          <stop stopColor="#16244f" />
          <stop offset="1" stopColor="#080e26" />
        </linearGradient>
        <radialGradient id="kimo-halo" cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#7ea2f8" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7ea2f8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {!compact ? <ellipse className="kimo-mascot__halo" cx="60" cy="52" rx="56" ry="50" fill="url(#kimo-halo)" /> : null}

      {!compact ? (
        <g className="kimo-mascot__trail">
          <path d="M16 40l2.2 5.2L23.4 47l-5.2 2.2L16 54.4l-2.2-5.2L8.6 47l5.2-1.8L16 40Z" fill="#fcd34d" />
          <circle cx="104" cy="34" r="2.6" fill="#75e2cf" />
          <circle cx="98" cy="76" r="2" fill="#f4b7dc" />
        </g>
      ) : null}

      <g className="kimo-mascot__character">
        {/* Stubby arms, tucked close so the silhouette stays compact. */}
        <g className="kimo-mascot__arm kimo-mascot__arm--left">
          <path d="M36 74h-7" stroke="#6f9dff" strokeWidth="8" strokeLinecap="round" />
        </g>
        <g className="kimo-mascot__arm kimo-mascot__arm--right">
          <path d="M84 74h7" stroke="#6f9dff" strokeWidth="8" strokeLinecap="round" />
        </g>

        {/* Short body — a rounded plinth rather than a torso with legs. */}
        <path d="M38 62h44v14c0 6.6-5.4 12-12 12H50c-6.6 0-12-5.4-12-12V62Z" fill="url(#kimo-case)" stroke="#c3daff" strokeWidth="2" />
        <rect x="52" y="70" width="16" height="9" rx="4.5" fill="#16244f" stroke="#8ac7ff" strokeWidth="1.4" />

        <g className="kimo-mascot__head">
          <path d="M60 14v-6" stroke="#9fc5ff" strokeWidth="3.4" strokeLinecap="round" />
          <circle className="kimo-mascot__antenna" cx="60" cy="6" r="4" fill="#86f4e5" />
          <rect x="20" y="14" width="80" height="52" rx="24" fill="url(#kimo-case)" stroke="#d3e4ff" strokeWidth="2" />
          <rect x="29" y="22" width="62" height="36" rx="16" fill="url(#kimo-screen)" stroke="#93baff" strokeOpacity="0.5" strokeWidth="1.5" />
          <g className="kimo-mascot__eyes kimo-mascot__eyes--calm">
            <rect x="43" y="35" width="9" height="9" rx="4.5" fill="#86f4e5" />
            <rect x="68" y="35" width="9" height="9" rx="4.5" fill="#86f4e5" />
          </g>
          <g className="kimo-mascot__eyes kimo-mascot__eyes--happy">
            <path d="M42 42q5.5 -8 11 0M67 42q5.5 -8 11 0" stroke="#e2ffff" strokeWidth="3.2" strokeLinecap="round" />
          </g>
          <path d="M53 50q7 4.5 14 0" stroke="#7ee9d8" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  )
}

export function AiAssistantSidebar({ onViewDetails, activeTargetId = null, currentUrl = '', onOpenTab }: AiAssistantSidebarProps) {
  const [mode, setMode] = useState<SidebarMode>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isChecking, setIsChecking] = useState(false)
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

  const hasMessages = messages.length > 0

  return (
    <aside className="assistant-panel" aria-label="Kimo panel">
      {/* Header */}
      <div className="assistant-header">
        <div className="assistant-header-left">
          <div className="assistant-logo">
            <KimoMascot compact />
          </div>
          <h2>Kimo</h2>
        </div>
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
      </div>

      {/* Agent mode stays mounted while chat is shown. Unmounting it would
          abort a running task and discard a half-written goal simply because
          the user glanced at the chat tab. */}
      <div className="assistant-pane" hidden={mode !== 'agent'}>
        <AgentModePanel targetId={activeTargetId} currentUrl={currentUrl} onOpenTab={onOpenTab} />
      </div>

      {mode === 'chat' ? (
        <div className="assistant-pane">
      {/* Welcome state or messages */}
      {!hasMessages ? (
        <div className="assistant-welcome">
          <div className="assistant-welcome-logo">
            <KimoMascot />
          </div>
          <h3>Kimo</h3>
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
