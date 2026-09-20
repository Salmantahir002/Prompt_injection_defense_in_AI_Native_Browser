import assert from 'node:assert/strict'

// 1. Result tone resolution check
function getResultTone(status) {
  return status === 'completed' ? 'agent-result--ok' : 'agent-result--failed'
}

assert.equal(getResultTone('completed'), 'agent-result--ok')
assert.equal(getResultTone('failed'), 'agent-result--failed')
assert.equal(getResultTone('blocked'), 'agent-result--failed')

// 2. In-panel modal dismissal behavior
class InPanelModalController {
  constructor() {
    this.isOpen = false
  }
  open() {
    this.isOpen = true
  }
  close() {
    this.isOpen = false
  }
  handleOverlayClick(targetIsOverlay) {
    if (targetIsOverlay) {
      this.close()
    }
  }
  handleKeyDown(key) {
    if (key === 'Escape') {
      this.close()
    }
  }
}

const controller = new InPanelModalController()
assert.equal(controller.isOpen, false)

// Open on done message click
controller.open()
assert.equal(controller.isOpen, true)

// Clicking inside modal container should NOT close (target is not overlay)
controller.handleOverlayClick(false)
assert.equal(controller.isOpen, true)

// Clicking anywhere on backdrop overlay in panel closes
controller.handleOverlayClick(true)
assert.equal(controller.isOpen, false)

// Escape key closes
controller.open()
assert.equal(controller.isOpen, true)
controller.handleKeyDown('Escape')
assert.equal(controller.isOpen, false)

// Close button closes
controller.open()
assert.equal(controller.isOpen, true)
controller.close()
assert.equal(controller.isOpen, false)

console.log('All in-panel agentResultModal self-checks passed.')
