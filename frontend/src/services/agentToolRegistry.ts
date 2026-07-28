import type { AgentToolCall, ResolvedToolCommand } from '../types/agentTypes'

/**
 * Frontend half of the Tool Registry: maps a validated planner tool call onto
 * a Browser Runtime command.
 *
 * This is a pure mapping and performs no execution. Nothing in Phase 4 drives
 * the browser — actions only become executable in Phase 5, once the security
 * circuit breaker exists to gate them. Wiring execution before that gate would
 * mean an agent that can act on an unscanned page.
 *
 * Tools that resolve to `null` are handled by the agent loop rather than the
 * browser: `extract` writes to working memory, `finish` ends the task, and
 * `upload` remains gated behind the Phase 7 approval workflow.
 */

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function resolveToolCall(call: AgentToolCall): ResolvedToolCommand {
  const args = call.arguments ?? {}

  switch (call.tool) {
    case 'click':
      return { command: 'click', params: { elementId: asString(args.target) } }
    case 'fill':
      return { command: 'fill', params: { elementId: asString(args.target), value: asString(args.value) } }
    case 'type':
      return { command: 'type', params: { text: asString(args.text) } }
    case 'press_key':
      return { command: 'pressKey', params: { key: asString(args.key) } }
    case 'navigate':
      return { command: 'navigate', params: { url: asString(args.url) } }
    case 'scroll':
      return {
        command: 'scroll',
        params: {
          elementId: args.target === undefined ? undefined : asString(args.target),
          deltaX: asNumber(args.deltaX),
          deltaY: asNumber(args.deltaY),
        },
      }
    case 'wait':
      return { command: 'waitForDomStable', params: { timeoutMs: asNumber(args.timeoutMs) } }
    // `open_tab` is loop-handled: the tab strip is renderer state, so the agent
    // loop creates the tab and re-points itself at it rather than sending a
    // command to the Browser Runtime, which only ever drives one existing tab.
    case 'open_tab':
    case 'upload':
    case 'extract':
    case 'finish':
      return null
    default:
      return null
  }
}

/** True when the tool ends the task rather than producing a browser action. */
export function isTerminalTool(call: AgentToolCall): boolean {
  return call.tool === 'finish'
}
