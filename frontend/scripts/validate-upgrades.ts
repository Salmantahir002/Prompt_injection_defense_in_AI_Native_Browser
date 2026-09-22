import assert from 'node:assert'
import { approvalFor, TOOL_CONFIDENCE_THRESHOLDS } from '../src/services/agentApprovalPolicy'
import { agentBrowserMemory } from '../src/services/agentBrowserMemory'
import { AgentTask } from '../src/services/agentRuntimeCore'
import { AgentRecoveryEngine } from '../src/services/agentRecoveryEngine'
import type { AgentToolCall } from '../types/agentTypes'
import type { PageStateSnapshot } from '../types/browserRuntimeTypes'

console.log('--- Starting Agent Upgrades Validation ---')

// -------------------------------------------------------------
// Test 1: Risk-Weighted Approval Thresholds
// -------------------------------------------------------------
console.log('\n[1] Testing Risk-Weighted Approval Thresholds...')

assert.strictEqual(TOOL_CONFIDENCE_THRESHOLDS.click, 0.70)
assert.strictEqual(TOOL_CONFIDENCE_THRESHOLDS.scroll, 0.0)
assert.strictEqual(TOOL_CONFIDENCE_THRESHOLDS.wait, 0.0)
assert.strictEqual(TOOL_CONFIDENCE_THRESHOLDS.extract, 0.0)
assert.strictEqual(TOOL_CONFIDENCE_THRESHOLDS.finish, 0.75)

const dummyPage: PageStateSnapshot = {
  targetId: 1,
  url: 'https://example.test',
  title: 'Test Page',
  capturedAt: Date.now(),
  elements: [
    { id: 'e1', role: 'button', name: 'Regular Button' },
    { id: 'e2', role: 'button', name: 'Buy Now and Checkout' },
    { id: 'e3', role: 'button', name: 'Delete Account' },
  ],
  focusedElementId: null,
  dialogs: [],
  validationErrors: [],
  selectedElementIds: [],
  truncated: false,
}

// 1a. Scroll with low confidence (0.20) should NEVER request approval
const scrollCall: AgentToolCall = { tool: 'scroll', arguments: { dy: 300 } }
const scrollApproval = approvalFor(scrollCall, dummyPage, { confidence: 0.20 })
assert.strictEqual(scrollApproval, null, 'Scroll with low confidence must not ask approval')

// 1b. Wait with low confidence (0.10) should NEVER request approval
const waitCall: AgentToolCall = { tool: 'wait', arguments: { timeoutMs: 1000 } }
const waitApproval = approvalFor(waitCall, dummyPage, { confidence: 0.10 })
assert.strictEqual(waitApproval, null, 'Wait with low confidence must not ask approval')

// 1c. Click with confidence 0.65 (below 0.70 threshold) should ask approval
const clickNormal: AgentToolCall = { tool: 'click', arguments: { target: 'e1' } }
const clickLowConfApproval = approvalFor(clickNormal, dummyPage, { confidence: 0.65 })
assert.notStrictEqual(clickLowConfApproval, null, 'Click below threshold must ask approval')
assert.strictEqual(clickLowConfApproval?.risk, 'low_confidence')
assert.match(clickLowConfApproval!.reason, /below the 70% threshold required for click/)

// 1d. Click with confidence 0.75 (above 0.70 threshold) should NOT ask approval
const clickHighConfApproval = approvalFor(clickNormal, dummyPage, { confidence: 0.75 })
assert.strictEqual(clickHighConfApproval, null, 'Click above threshold must not ask approval')

// 1e. Financial and destructive rules trigger regardless of confidence
const clickFinancial: AgentToolCall = { tool: 'click', arguments: { target: 'e2' } }
const financialApproval = approvalFor(clickFinancial, dummyPage, { confidence: 0.99 })
assert.notStrictEqual(financialApproval, null)
assert.strictEqual(financialApproval?.risk, 'financial')

const clickDestructive: AgentToolCall = { tool: 'click', arguments: { target: 'e3' } }
const destructiveApproval = approvalFor(clickDestructive, dummyPage, { confidence: 0.99 })
assert.notStrictEqual(destructiveApproval, null)
assert.strictEqual(destructiveApproval?.risk, 'destructive')

console.log('✓ All Risk-Weighted Approval tests passed!')

// -------------------------------------------------------------
// Test 2: Loop / Stagnation Detector
// -------------------------------------------------------------
console.log('\n[2] Testing Loop / Stagnation Detector...')

const task = new AgentTask({
  taskId: 'task-test-stagnation',
  goal: 'Test loop detection',
  targetId: 1,
})

const testToolCall: AgentToolCall = { tool: 'click', arguments: { target: 'e1' } }

// Access private method detectStagnation for validation
const detectStagnation = (task as unknown as {
  detectStagnation: (toolCall: AgentToolCall, pageState: PageStateSnapshot) => boolean
}).detectStagnation.bind(task)

// Call 1
const isStagnant1 = detectStagnation(testToolCall, dummyPage)
assert.strictEqual(isStagnant1, false, 'First action should not trigger stagnation')

// Call 2
const isStagnant2 = detectStagnation(testToolCall, dummyPage)
assert.strictEqual(isStagnant2, false, 'Second action should not trigger stagnation')

// Call 3 - identical action on identical page -> stagnation!
const isStagnant3 = detectStagnation(testToolCall, dummyPage)
assert.strictEqual(isStagnant3, true, 'Third repetition must trigger stagnation')

// A different tool should not be stagnant
const differentCall: AgentToolCall = { tool: 'scroll', arguments: { dy: 200 } }
const isStagnantDiff = detectStagnation(differentCall, dummyPage)
assert.strictEqual(isStagnantDiff, false, 'Different action should not trigger stagnation')

console.log('✓ Loop / Stagnation Detector tests passed!')

// -------------------------------------------------------------
// Test 3: Don\'t Crash on Blocked Side Pages & Recovery Engine
// -------------------------------------------------------------
console.log('\n[3] Testing Blocked Side Pages & Recovery Engine...')

// 3a. Browser memory blocked origin check
agentBrowserMemory.markBlocked('https://blocked-tracker.test/ad')
assert.strictEqual(agentBrowserMemory.isBlocked('https://blocked-tracker.test/ad'), true)
assert.strictEqual(agentBrowserMemory.isBlocked('https://example.test'), false)

// 3b. Recovery Engine maps NAVIGATION_BLOCKED to 'replan' instead of aborting
const recoveryEngine = new AgentRecoveryEngine()
const plan = recoveryEngine.plan({
  toolCall: { tool: 'navigate', arguments: { url: 'https://blocked-tracker.test/ad' } },
  errorCode: 'NAVIGATION_BLOCKED',
  message: 'Navigation scheme or host is blocked',
})

assert.strictEqual(plan.strategy, 'replan', 'NAVIGATION_BLOCKED must trigger replan, not abort!')
console.log(`✓ Recovery engine planned: strategy = '${plan.strategy}' (did not abort)`)

console.log('\n=== ALL UPGRADE VALIDATION CHECKS PASSED SUCCESSFULLY ===')
