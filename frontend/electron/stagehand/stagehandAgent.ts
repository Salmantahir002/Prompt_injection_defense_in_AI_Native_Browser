import { webContents } from 'electron'
import { AGENT_API_BASE_URL, OPENCODE_ZEN_API_KEY, OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_MODEL } from '../config.js'
import { visualOverlay } from './visualOverlay.js'
import type { CdpInspectionService } from '../cdpInspectionService.js'

export type AgentTaskEventCallback = (event: {
  type: 'status' | 'step' | 'security_block' | 'result'
  payload: any
}) => void

export type RunAgentTaskOptions = {
  taskId: string
  goal: string
  targetId: number
  signal?: AbortSignal
  visualFeedback?: boolean
  onEvent?: AgentTaskEventCallback
  requestOpenTab?: (url?: string) => Promise<number | null>
}

export type AgentThreatFinding = {
  source: string
  confidence: number
  matched_patterns: string[]
  matched_evidence: string[]
  excerpt: string
}

export type AgentScanDecision = {
  allowed: boolean
  task_id: string
  url: string
  page_hash: string
  risk_level: 'low' | 'medium' | 'high'
  confidence: number
  summary_reason: string
  matched_patterns: string[]
  blocked_sources: string[]
  findings: AgentThreatFinding[]
  scanned_chunks: number
  classifier_mode: string
  scanned_at: string
  fromCache?: boolean
}

export class StagehandAgentService {
  private cdpInspector: CdpInspectionService | null = null
  private activeTasks = new Map<string, { abortController: AbortController; targetId: number }>()
  private securityCache = new Map<string, AgentScanDecision>()

  setCdpInspector(inspector: CdpInspectionService) {
    this.cdpInspector = inspector
  }

  stopTask(taskId?: string) {
    if (taskId) {
      const task = this.activeTasks.get(taskId)
      if (task) {
        task.abortController.abort()
        this.activeTasks.delete(taskId)
      }
    } else {
      // Stop all active tasks
      for (const [id, task] of this.activeTasks.entries()) {
        task.abortController.abort()
        this.activeTasks.delete(id)
      }
    }
  }

  /**
   * Performs deep prompt injection scan before every action with in-memory hashing cache.
   */
  async scanPageForInjection(
    taskId: string,
    targetId: number,
    signal?: AbortSignal,
  ): Promise<AgentScanDecision> {
    if (!this.cdpInspector) {
      throw new Error('CDP inspection service is not available.')
    }

    const snapshot = await this.cdpInspector.capture(targetId)
    if (!snapshot) {
      throw new Error('Failed to capture page snapshot for security analysis.')
    }

    const url = snapshot.url || 'about:blank'
    const pageHash = Buffer.from(snapshot.visible_text.slice(0, 500) + snapshot.hidden_text.slice(0, 500)).toString('base64').slice(0, 16)
    const cacheKey = `${taskId}:${url}:${pageHash}`

    const cached = this.securityCache.get(cacheKey)
    if (cached) {
      return { ...cached, fromCache: true }
    }

    const response = await fetch(`${AGENT_API_BASE_URL}/agent/scan-active-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: taskId,
        url,
        page_hash: pageHash,
        snapshot,
      }),
      signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Security scan failed (${response.status}): ${errorText}`)
    }

    const decision = (await response.json()) as AgentScanDecision
    this.securityCache.set(cacheKey, decision)
    return decision
  }

  /**
   * Runs an autonomous task with the security checkpoint and visual feedback.
   */
  async runTask(options: RunAgentTaskOptions): Promise<{
    taskId: string
    status: 'completed' | 'blocked' | 'failed'
    message: string
    steps: number
    decision?: AgentScanDecision | null
  }> {
    const { taskId, goal, onEvent } = options
    let targetId = options.targetId
    const abortController = new AbortController()
    this.activeTasks.set(taskId, { abortController, targetId })

    if (options.signal) {
      options.signal.addEventListener('abort', () => abortController.abort())
    }

    const signal = abortController.signal
    let guestContents = webContents.fromId(targetId)
    const visualEnabled = options.visualFeedback !== false
    visualOverlay.setEnabled(visualEnabled)

    let stepCount = 0

    const emit = (type: 'status' | 'step' | 'security_block' | 'result', payload: any) => {
      onEvent?.({ type, payload })
    }

    try {
      if (!guestContents || guestContents.isDestroyed()) {
        throw new Error(`WebContents target ${targetId} is not available.`)
      }

      emit('status', 'Starting secure Stagehand agent...')
      if (visualEnabled) {
        void visualOverlay.setGlow(guestContents, true)
      }

      // Memory of completed actions
      const history: { action: string; result: string }[] = []
      const maxSteps = 15
      let isFinished = false

      while (!isFinished && stepCount < maxSteps) {
        if (signal.aborted) {
          throw new Error('Task was cancelled by the user.')
        }

        stepCount++
        emit('status', `Step ${stepCount}: Analyzing page security & elements...`)

        // 1. Visual feedback: fire left-to-right scan sweep effect asynchronously
        if (visualEnabled) {
          void visualOverlay.scanSweep(guestContents)
        }

        // 2. Parallel Security Checkpoint & Element Extraction
        const [decision, elementData]: [AgentScanDecision, any] = await Promise.all([
          this.scanPageForInjection(taskId, targetId, signal),
          guestContents.executeJavaScript(`
            (function() {
              var items = [];
              var elements = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="searchbox"]');
              var idx = 0;
              for (var i = 0; i < elements.length; i++) {
                var el = elements[i];
                if (!el || el.offsetParent === null && el.tagName !== 'BODY') continue;
                var rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
                
                var text = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('value') || '').trim();
                var tag = el.tagName.toLowerCase();
                idx++;
                items.push({
                  index: idx,
                  tag: tag,
                  text: text.slice(0, 80),
                  type: el.type || '',
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.top + rect.height / 2),
                  rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
                });
                if (items.length >= 35) break;
              }
              return items;
            })()
          `).catch(() => [])
        ])

        if (!decision.allowed) {
          console.warn(`[stagehand-agent] Task ${taskId} BLOCKED due to prompt injection:`, decision.summary_reason)
          emit('security_block', {
            state: 'open',
            message: decision.summary_reason,
            decision,
            blockedAt: new Date().toISOString(),
          })

          if (visualEnabled) {
            void visualOverlay.setGlow(guestContents, false)
            void visualOverlay.clear(guestContents)
          }

          return {
            taskId,
            status: 'blocked',
            message: `Task halted immediately for your safety: ${decision.summary_reason}`,
            steps: stepCount,
            decision,
          }
        }

        const pageUrl = guestContents.getURL()
        const pageTitle = guestContents.getTitle()

        // 4. Decide next action using OpenCode Zen LLM
        emit('status', `Step ${stepCount}: Reasoning next action for goal...`)

        const promptMessages = [
          {
            role: 'system',
            content: `You are an autonomous browser agent. Your goal is to accomplish the user's objective on the webpage or across tabs.
Current Webpage:
- Title: "${pageTitle}"
- URL: "${pageUrl}"

Available Interactive Elements on screen:
${JSON.stringify(elementData, null, 2)}

Action History:
${history.map((h, i) => `${i + 1}. Action: ${h.action} -> Result: ${h.result}`).join('\n') || 'None'}

You must choose ONE action from:
1. {"action": "open_tab", "url": "<target url or https://www.google.com or about:blank>", "description": "<brief description>"} - USE THIS when the user asks to open a new tab, or open a site in a new tab.
2. {"action": "click", "elementIndex": <number>, "description": "<brief description>"}
3. {"action": "type", "elementIndex": <number>, "text": "<string to type>", "pressEnter": <boolean>, "description": "<brief description>"}
4. {"action": "navigate", "url": "<target url>", "description": "<brief description>"}
5. {"action": "scroll", "direction": "down" | "up", "description": "<brief description>"}
6. {"action": "wait", "seconds": <number>, "description": "<brief description>"}
7. {"action": "finish", "message": "<completion message>"} - USE THIS only when the user's goal has been fully accomplished.

Respond ONLY with strict JSON.`,
          },
          {
            role: 'user',
            content: `User Goal: "${goal}". What is the next action?`,
          },
        ]

        const llmResponse = await fetch(`${OPENCODE_ZEN_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENCODE_ZEN_API_KEY}`,
          },
          body: JSON.stringify({
            model: OPENCODE_ZEN_MODEL,
            messages: promptMessages,
            temperature: 0.1,
            max_tokens: 200,
            response_format: { type: 'json_object' },
          }),
          signal,
        })

        if (!llmResponse.ok) {
          const errText = await llmResponse.text().catch(() => '')
          throw new Error(`LLM reasoning failed (${llmResponse.status}): ${errText}`)
        }

        const llmData = (await llmResponse.json()) as any
        const messageObj = llmData.choices?.[0]?.message
        const responseContent = (typeof messageObj?.content === 'string' && messageObj.content)
          ? messageObj.content
          : (typeof messageObj?.reasoning === 'string' ? messageObj.reasoning : '{}')
        let plan: any
        try {
          plan = JSON.parse(responseContent)
        } catch {
          const match = responseContent.match(/\{[\s\S]*\}/)
          plan = match ? JSON.parse(match[0]) : { action: 'finish', message: responseContent }
        }

        // 5. Execute Action with Visual Cursor & Native Events
        if (plan.action === 'finish') {
          isFinished = true
          emit('step', {
            step: stepCount,
            toolCall: { tool: 'finish', arguments: { message: plan.message } },
            decision,
          })
          emit('status', `Done: ${plan.message}`)
          break
        }

        if (plan.action === 'open_tab') {
          emit('step', {
            step: stepCount,
            toolCall: { tool: 'open_tab', arguments: { url: plan.url || 'about:blank' } },
            decision,
          })
          emit('status', `Opening new tab: ${plan.url || 'New Tab'}...`)

          if (options.requestOpenTab) {
            const newTargetId = await options.requestOpenTab(plan.url)
            if (newTargetId) {
              targetId = newTargetId
              const newGuest = webContents.fromId(newTargetId)
              if (newGuest) {
                guestContents = newGuest
              }
              history.push({
                action: `Opened new tab: ${plan.url || 'about:blank'}`,
                result: `New tab created with target ID ${newTargetId}`,
              })

              const normGoal = goal.toLowerCase().trim()
              if (normGoal === 'open new tab' || normGoal === 'open tab' || normGoal === 'new tab') {
                isFinished = true
                emit('status', `Done: Opened new tab successfully.`)
                emit('step', {
                  step: stepCount + 1,
                  toolCall: { tool: 'finish', arguments: { message: 'Opened new tab successfully.' } },
                  decision,
                })
                break
              }

              await new Promise((resolve) => setTimeout(resolve, 300))
            } else {
              history.push({
                action: `Open new tab`,
                result: `Tab creation was cancelled or timed out`,
              })
            }
          }
        } else if (plan.action === 'click') {
          const targetEl = elementData.find((el: any) => el.index === plan.elementIndex) || elementData[0]
          if (targetEl) {
            emit('step', {
              step: stepCount,
              toolCall: { tool: 'click', arguments: { target: targetEl.text || targetEl.tag, x: targetEl.x, y: targetEl.y } },
              decision,
            })

            if (visualEnabled) {
              await visualOverlay.moveTo(guestContents, targetEl.x, targetEl.y, `Clicking "${targetEl.text || targetEl.tag}"`)
              await visualOverlay.clickAt(guestContents, targetEl.x, targetEl.y)
            }

            // Execute click in page
            await guestContents.executeJavaScript(`
              (function() {
                var el = document.elementFromPoint(${targetEl.x}, ${targetEl.y});
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.focus();
                  el.click();
                }
              })()
            `).catch(() => undefined)

            history.push({
              action: `Clicked element "${targetEl.text || targetEl.tag}"`,
              result: 'Click executed successfully',
            })
          }
        } else if (plan.action === 'type') {
          const targetEl = elementData.find((el: any) => el.index === plan.elementIndex) || elementData[0]
          if (targetEl) {
            emit('step', {
              step: stepCount,
              toolCall: { tool: 'type', arguments: { text: plan.text, target: targetEl.text || targetEl.tag } },
              decision,
            })

            if (visualEnabled) {
              await visualOverlay.moveTo(guestContents, targetEl.x, targetEl.y, `Typing "${plan.text}"`)
              await visualOverlay.clickAt(guestContents, targetEl.x, targetEl.y)
            }

            await guestContents.executeJavaScript(`
              (function() {
                var el = document.elementFromPoint(${targetEl.x}, ${targetEl.y});
                if (el) {
                  el.focus();
                  el.value = ${JSON.stringify(plan.text)};
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  ${plan.pressEnter ? `
                    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                    el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
                    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
                    if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
                  ` : ''}
                }
              })()
            `).catch(() => undefined)

            history.push({
              action: `Typed "${plan.text}" into "${targetEl.text || targetEl.tag}"`,
              result: 'Input typed and submitted',
            })
          }
        } else if (plan.action === 'navigate' && plan.url) {
          emit('step', {
            step: stepCount,
            toolCall: { tool: 'navigate', arguments: { url: plan.url } },
            decision,
          })
          emit('status', `Navigating to ${plan.url}...`)
          await guestContents.loadURL(plan.url).catch(() => undefined)
          history.push({
            action: `Navigated to ${plan.url}`,
            result: 'Page loaded',
          })
        } else if (plan.action === 'scroll') {
          const delta = plan.direction === 'up' ? -400 : 400
          emit('step', {
            step: stepCount,
            toolCall: { tool: 'scroll', arguments: { direction: plan.direction } },
            decision,
          })
          await guestContents.executeJavaScript(`window.scrollBy({ top: ${delta}, behavior: 'smooth' })`).catch(() => undefined)
          history.push({
            action: `Scrolled ${plan.direction}`,
            result: 'Scrolled page',
          })
        } else if (plan.action === 'wait') {
          const secs = Number(plan.seconds) || 2
          emit('step', {
            step: stepCount,
            toolCall: { tool: 'wait', arguments: { seconds: secs } },
            decision,
          })
          emit('status', `Waiting ${secs}s for page update...`)
          await new Promise((resolve) => setTimeout(resolve, secs * 1000))
        }

        // Fast transition between actions
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      if (visualEnabled) {
        await visualOverlay.setGlow(guestContents, false)
        await visualOverlay.clear(guestContents)
      }

      return {
        taskId,
        status: 'completed',
        message: `Task completed successfully in ${stepCount} steps.`,
        steps: stepCount,
      }
    } catch (err: any) {
      if (visualEnabled && guestContents && !guestContents.isDestroyed()) {
        await visualOverlay.setGlow(guestContents, false)
        await visualOverlay.clear(guestContents)
      }

      const isAborted = signal.aborted || err.name === 'AbortError' || err.message?.includes('cancelled')
      return {
        taskId,
        status: 'failed',
        message: isAborted ? 'Task was stopped by the user.' : (err.message || 'An error occurred during task execution.'),
        steps: stepCount,
      }
    } finally {
      this.activeTasks.delete(taskId)
    }
  }
}

export const stagehandAgentService = new StagehandAgentService()
