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

function AssistantLogoSvg({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size, color: '#8ab4f8' }}>
      <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
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
    <aside className="assistant-panel" aria-label="Assistant panel">
      {/* Header */}
      <div className="assistant-header">
        <div className="assistant-header-left">
          <div className="assistant-logo">
            <AssistantLogoSvg size={16} />
          </div>
          <h2>Assistant</h2>
        </div>
      </div>

      {/* Welcome state or messages */}
      {!hasMessages ? (
        <div className="assistant-welcome">
          <div className="assistant-welcome-logo">
            <AssistantLogoSvg size={28} />
          </div>
          <h3>Assistant</h3>
          <p>
            Prompt Defense Assistant analyzes your prompts and page content for security threats
            before they reach the AI model.
          </p>
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
