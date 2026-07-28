import type { AgentToolCall } from '../types/agentTypes'
import type { PageStateSnapshot, SemanticElement } from '../types/browserRuntimeTypes'

/**
 * Decides which actions need explicit human consent before they run.
 *
 * Two sources feed this:
 *  - the backend tool registry, via `requires_approval` on the tool call;
 *  - a local reading of *what the action would actually do*, since a click is
 *    an ordinary click right up until the button says "Place order".
 *
 * The consequences the spec names — purchases, payments, deletion,
 * irreversible submissions — are not visible in the tool name. They are
 * visible in the accessible name of the control, which is the same text a
 * person would read before deciding.
 */

export type ApprovalRequest = {
  toolCall: AgentToolCall
  /** Short sentence for the dialog: what is about to happen. */
  summary: string
  /** Why consent is being asked, for the dialog's secondary line. */
  reason: string
  risk: 'irreversible' | 'financial' | 'destructive' | 'upload' | 'low_confidence'
}

type Rule = { pattern: RegExp; risk: ApprovalRequest['risk']; reason: string }

/**
 * Word-boundary matching keeps "Buy" from firing on "Buyer's guide" and
 * "pay" from firing on "payload" or "paypal.com/help".
 */
const RULES: readonly Rule[] = [
  {
    pattern: /\b(buy|purchase|order now|place (the )?order|checkout|check out|add to cart|subscribe|book now|reserve)\b/i,
    risk: 'financial',
    reason: 'This looks like it completes a purchase.',
  },
  {
    pattern: /\b(pay|payment|donate|transfer|send money|confirm and pay|authorise|authorize)\b/i,
    risk: 'financial',
    reason: 'This looks like it authorises a payment.',
  },
  {
    pattern: /\b(delete|remove|discard|erase|destroy|deactivate|close account|unsubscribe|cancel (my )?(subscription|account))\b/i,
    risk: 'destructive',
    reason: 'This looks like it deletes something that may not be recoverable.',
  },
  {
    pattern: /\b(submit|send|post|publish|apply now|confirm|agree|accept|sign)\b/i,
    risk: 'irreversible',
    reason: 'This submits a form, which usually cannot be undone.',
  },
]

function describeElement(element: SemanticElement | undefined, fallback: string): string {
  if (!element) return fallback
  return `${element.role} "${element.name}"`
}

/**
 * Returns an approval request when consent is required, or null to proceed.
 */
export function approvalFor(
  toolCall: AgentToolCall,
  pageState: PageStateSnapshot | null,
  options: { lowConfidence?: boolean; confidence?: number } = {},
): ApprovalRequest | null {
  const target = typeof toolCall.arguments?.target === 'string'
    ? pageState?.elements.find((element) => element.id === toolCall.arguments.target)
    : undefined

  if (toolCall.requires_approval || toolCall.tool === 'upload') {
    return {
      toolCall,
      summary: `Attach files to ${describeElement(target, 'a file field')}`,
      reason: 'You will choose the files yourself; the agent cannot pick them.',
      risk: 'upload',
    }
  }

  // Only actions that actually commit something are worth interrupting for.
  // Typing into a field or scrolling is freely reversible.
  if (toolCall.tool === 'click' || toolCall.tool === 'press_key') {
    const label = target
      ? `${target.name} ${target.description ?? ''}`
      : String(toolCall.arguments?.key ?? '')

    const matched = RULES.find((rule) => rule.pattern.test(label))
    if (matched) {
      return {
        toolCall,
        summary: `Click ${describeElement(target, 'a control')}`,
        reason: matched.reason,
        risk: matched.risk,
      }
    }
  }

  if (options.lowConfidence) {
    const percent = Math.round((options.confidence ?? 0) * 100)
    return {
      toolCall,
      summary: `${toolCall.tool} ${describeElement(target, '')}`.trim(),
      reason: `The planner was only ${percent}% confident this is the right action.`,
      risk: 'low_confidence',
    }
  }

  return null
}

/** Resolves an approval request. The UI supplies the implementation. */
export type ApprovalHandler = (request: ApprovalRequest) => Promise<boolean>
