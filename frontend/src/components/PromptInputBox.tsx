import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'

type PromptInputBoxProps = {
  disabled: boolean
  onSubmit: (prompt: string) => Promise<void>
  clearSignal: number
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}>
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  )
}

export function PromptInputBox({ disabled, onSubmit, clearSignal }: PromptInputBoxProps) {
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    // Force-clear textarea on each submit cycle (robust against parent remounts/re-renders).
    setPrompt('')
  }, [clearSignal])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt || disabled) {
      return
    }

    await onSubmit(trimmedPrompt)
    // Prefer clear via clearSignal effect, but keep this as a fallback.
    setPrompt('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const form = event.currentTarget.closest('form')
      form?.requestSubmit()
    }
  }

  return (
    <form className="prompt-form" onSubmit={handleSubmit}>
      <textarea
        className="prompt-textarea"
        disabled={disabled}
        placeholder="Type / for search modes"
        rows={1}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="prompt-form-footer">
        <div className="prompt-form-actions">
          {/* Placeholder action buttons for future features */}
        </div>
        <button className="prompt-submit" type="submit" disabled={disabled || !prompt.trim()} aria-label="Send">
          <SendIcon />
        </button>
      </div>
    </form>
  )
}
