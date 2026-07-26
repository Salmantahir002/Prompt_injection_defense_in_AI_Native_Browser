import { useRef, useState, useEffect } from 'react'
import { checkPrompt, chatWithLlm } from '../services/backendApiClient'
import type { AnalysisDetails } from '../types/analysisDetailsTypes'
import type { LlmResponse, SecurityCheckResponse, SecurityEvent } from '../types/securityTypes'
import { PromptInputBox } from './PromptInputBox'

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
  onSecurityEvent?: (event: SecurityEvent) => void
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

function KimoMascot({ compact = false }: { compact?: boolean }) {
  return (
    <svg className={`kimo-mascot ${compact ? 'kimo-mascot--compact' : ''}`} viewBox="0 0 160 150" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="kimo-case" x1="45" y1="26" x2="115" y2="112" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a8c8ff" />
          <stop offset="0.52" stopColor="#628ef4" />
          <stop offset="1" stopColor="#314aab" />
        </linearGradient>
        <linearGradient id="kimo-screen" x1="54" y1="39" x2="106" y2="75" gradientUnits="userSpaceOnUse">
          <stop stopColor="#182b62" />
          <stop offset="1" stopColor="#0b1434" />
        </linearGradient>
      </defs>
      {!compact ? (
        <g className="kimo-mascot__trail">
          <path d="M31 77l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="#fcd34d" />
          <path d="M45 99l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2 2-4.5Z" fill="#a9d7ff" />
          <circle cx="27" cy="109" r="3" fill="#75e2cf" />
          <circle cx="49" cy="55" r="2" fill="#f4b7dc" />
        </g>
      ) : null}
      <g className="kimo-mascot__character">
        <g className="kimo-mascot__arm kimo-mascot__arm--left">
          <path d="M56 91 40 103" stroke="#6f9dff" strokeWidth="8" strokeLinecap="round" />
          <circle cx="38" cy="105" r="6" fill="#8db7ff" />
        </g>
        <g className="kimo-mascot__arm kimo-mascot__arm--right">
          <path d="m104 91 16 12" stroke="#6f9dff" strokeWidth="8" strokeLinecap="round" />
          <circle cx="122" cy="105" r="6" fill="#8db7ff" />
        </g>
        <g className="kimo-mascot__head">
          <path d="M68 29 73 22h14l5 7" stroke="#9fc5ff" strokeWidth="4" strokeLinecap="round" />
          <rect x="43" y="30" width="74" height="55" rx="19" fill="url(#kimo-case)" stroke="#c3daff" strokeWidth="2" />
          <rect x="52" y="39" width="56" height="35" rx="12" fill="url(#kimo-screen)" stroke="#93baff" strokeOpacity="0.55" strokeWidth="1.5" />
          <g className="kimo-mascot__eyes kimo-mascot__eyes--calm">
            <path d="M63 56h9M88 56h9" stroke="#86f4e5" strokeWidth="3" strokeLinecap="round" />
          </g>
          <g className="kimo-mascot__eyes kimo-mascot__eyes--happy">
            <path d="M62 53q5 7 10 0M87 53q5 7 10 0" stroke="#e2ffff" strokeWidth="3" strokeLinecap="round" />
          </g>
          <path d="M73 66q7 4 14 0" stroke="#7ee9d8" strokeWidth="2" strokeLinecap="round" />
        </g>
        <path d="M60 84h40v28c0 8-7 14-16 14h-8c-9 0-16-6-16-14V84Z" fill="url(#kimo-case)" stroke="#bed8ff" strokeWidth="2" />
        <rect x="72" y="94" width="16" height="12" rx="4" fill="#182b62" stroke="#8ac7ff" strokeWidth="1.5" />
        <path d="M68 124v7M92 124v7" stroke="#87adff" strokeWidth="7" strokeLinecap="round" />
        <path d="M61 132h15M84 132h15" stroke="#9bc2ff" strokeWidth="6" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export function AiAssistantSidebar({ onViewDetails, onSecurityEvent }: AiAssistantSidebarProps) {
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

      // Trigger security event callback
      onSecurityEvent?.({
        allowed: result.allowed,
        label: result.label,
        source: result.source,
        summary_reason: result.summary_reason,
        timestamp: result.timestamp,
      })

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
      </div>

      {/* Welcome state or messages */}
      {!hasMessages ? (
        <div className="assistant-welcome">
          <div className="assistant-welcome-logo">
            <KimoMascot />
          </div>
          <h3>Kimo</h3>
          <p>Kimo here—your personal prompt-defense assistant.</p>
        </div>
      ) : (
        <div className="chat-messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-message chat-message--${msg.sender}`}>
              {msg.sender === 'user' && msg.text ? (
                <div className="chat-bubble chat-bubble--user">{msg.text}</div>
              ) : null}

              {msg.sender === 'assistant' && msg.isChecking ? (
                <div className="chat-bubble chat-bubble--checking">
                  Analyzing
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
                      View Detailed Analysis
                    </button>
                  </div>
                </div>
              ) : null}

              {msg.sender === 'assistant' && msg.llmResponse ? (
                <p className="llm-placeholder">{msg.llmResponse.response}</p>
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
    </aside>
  )
}
