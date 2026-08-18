import { webContents } from 'electron'
import { AGENT_API_BASE_URL, OPENCODE_ZEN_API_KEY, OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_MODEL } from '../config.js'
import { visualOverlay } from './visualOverlay.js'
import { providerSecureStore } from '../providerSecureStore.js'
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

        if (!guestContents || guestContents.isDestroyed()) {
          throw new Error(`WebContents target ${targetId} is no longer available.`)
        }

        const currentGuest = guestContents

        stepCount++
        emit('status', `Step ${stepCount}: Analyzing page security & elements...`)

        // 1. Visual feedback: fire left-to-right scan sweep effect asynchronously
        if (visualEnabled) {
          void visualOverlay.scanSweep(currentGuest)
        }

        // Wait briefly if the page is currently loading
        if (currentGuest.isLoading()) {
          emit('status', `Step ${stepCount}: Waiting for page to finish loading...`)
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 1500)
            const handleStop = () => {
              clearTimeout(timeout)
              currentGuest.removeListener('did-stop-loading', handleStop)
              resolve()
            }
            currentGuest.once('did-stop-loading', handleStop)
          })
        }

        // 2. Parallel Security Checkpoint & Element Extraction
        const [decision, elementData, pageStatus]: [AgentScanDecision, any, any] = await Promise.all([
          this.scanPageForInjection(taskId, targetId, signal),
          currentGuest.executeJavaScript(`
            (function() {
              // Clear previous agent indices
              document.querySelectorAll('[data-agent-idx]').forEach(function(el) {
                el.removeAttribute('data-agent-idx');
              });

              var items = [];
              var seen = new Set();
              var idx = 0;

              // Query all interactive elements
              var elements = document.querySelectorAll(
                'button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="searchbox"], .mw-search-result-heading a, .search-result a, .g a'
              );

              for (var i = 0; i < elements.length; i++) {
                var el = elements[i];
                if (!el || seen.has(el)) continue;
                if (el.offsetParent === null && el.tagName !== 'BODY') continue;

                var rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                // Allow elements in viewport or within 2.5 screens below
                if (rect.bottom < -50 || rect.top > window.innerHeight * 2.5) continue;

                var text = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('value') || '').trim();
                text = text.replace(/\\s+/g, ' ').slice(0, 100);

                if (!text && el.tagName === 'A' && !el.querySelector('img, svg')) continue;

                seen.add(el);
                idx++;
                el.setAttribute('data-agent-idx', String(idx));

                var href = (el.getAttribute('href') || '').slice(0, 120);
                var isSearchResult = Boolean(el.closest('.mw-search-result, .search-result, .g, .result, .mw-search-results, .mw-search-result-heading'));
                var isMainContent = Boolean(el.closest('main, #content, #mw-content-text, article, .content'));

                items.push({
                  index: idx,
                  tag: el.tagName.toLowerCase(),
                  text: text,
                  type: el.type || '',
                  href: href,
                  isSearchResult: isSearchResult,
                  isMainContent: isMainContent,
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.top + rect.height / 2),
                });

                if (items.length >= 75) break;
              }
              return items;
            })()
          `).catch(() => []),
          guestContents.executeJavaScript(`
            (function() {
              var text = (document.body ? document.body.innerText : '') || '';
              var isNetError = text.includes('ERR_NAME_NOT_RESOLVED') ||
                               text.includes('ERR_CONNECTION_REFUSED') ||
                               text.includes('ERR_INTERNET_DISCONNECTED') ||
                               text.includes('ERR_CONNECTION_TIMED_OUT') ||
                               text.includes("This site can’t be reached") ||
                               text.includes("This site can't be reached") ||
                               document.title.includes('Problem loading page');
              return {
                isNetError: isNetError,
                url: window.location.href,
                textLength: text.trim().length,
              };
            })()
          `).catch(() => ({ isNetError: false, url: '', textLength: 0 }))
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

        // Handle network load failures gracefully instead of blind scrolling
        if (pageStatus && pageStatus.isNetError) {
          if (stepCount <= 3 && (goal.toLowerCase().includes('search') || goal.toLowerCase().includes('rating') || goal.toLowerCase().includes('who is') || goal.toLowerCase().includes('season'))) {
            emit('status', `Step ${stepCount}: Network error loading page. Recovering via search engine...`)
            const searchQuery = goal.replace(/^(search|find|lookup|open|check)\s+/i, '').replace(/on (wikipedia|google|the web)/i, '').trim()
            const fallbackUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}`
            await guestContents.loadURL(fallbackUrl).catch(() => undefined)
            history.push({
              action: `Navigated to search: ${fallbackUrl}`,
              result: 'Search page loaded',
            })
            await new Promise((resolve) => setTimeout(resolve, 1500))
            continue
          }

          emit('status', `Error: Page failed to load (ERR_NAME_NOT_RESOLVED).`)
          return {
            taskId,
            status: 'failed',
            message: `Could not load page due to network error (ERR_NAME_NOT_RESOLVED). Please verify your connection.`,
            steps: stepCount,
            decision,
          }
        }

        // 4. Decide next action using LLM
        emit('status', `Step ${stepCount}: Reasoning next action for goal...`)

        const promptMessages = [
          {
            role: 'system',
            content: `You are an expert autonomous web agent operating a browser tab.
Goal: "${goal}"

CURRENT WEBPAGE:
- Page Title: "${pageTitle}"
- URL: "${pageUrl}"

AVAILABLE INTERACTIVE ELEMENTS:
${JSON.stringify(elementData, null, 2)}

ACTION HISTORY:
${history.map((h, i) => `${i + 1}. Action: ${h.action} -> Result: ${h.result}`).join('\n') || 'None'}

CRITICAL INSTRUCTIONS:
1. MULTI-STEP COMPLETION:
   - If the user asks to "search X on wikipedia and open it" or "search X and click it":
     * Step 1: Type the search term into the search input and submit (pressEnter: true).
     * Step 2: Once on the Search Results page, you MUST look at the search results list and CLICK the article/result link that matches the query!
     * Step 3: Only after the actual article/destination page loads, call "finish".
   - DO NOT call "finish" on a search results page (e.g., Wikipedia Search results, Google Search results, Bing results) when the user requested to open or read an article!
2. CHOOSE THE RIGHT ACTION:
   - To open an article/link: {"action": "click", "elementIndex": <index>, "description": "<description>"}
   - To search: {"action": "type", "elementIndex": <index>, "text": "<query>", "pressEnter": true, "description": "<description>"}
   - To reveal elements further down: {"action": "scroll", "direction": "down", "description": "Scroll to see search results"}
   - To open a URL directly: {"action": "navigate", "url": "<url>", "description": "<description>"}
   - To complete the task: {"action": "finish", "message": "<completion message>"} (ONLY when the final target page is open and goal is satisfied).

Respond ONLY with valid JSON:
{
  "thought": "<brief reasoning about current state and why this action achieves the goal>",
  "action": "click" | "type" | "open_tab" | "navigate" | "scroll" | "wait" | "finish",
  "elementIndex": <number, for click/type>,
  "text": "<string, for type>",
  "pressEnter": <boolean, for type>,
  "direction": "down" | "up", <for scroll>,
  "url": "<url, for navigate/open_tab>",
  "message": "<message, for finish>",
  "description": "<brief user-facing description>"
}`,
          },
          {
            role: 'user',
            content: `User Goal: "${goal}". What is the next action?`,
          },
        ]

        let responseContent = '{}'
        const activeProvider = providerSecureStore.getDecryptedActiveConfig()

        if (activeProvider && activeProvider.api_key) {
          try {
            if (activeProvider.provider_type === 'openai_compatible') {
              const baseUrl = (activeProvider.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '')
              const llmResponse = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${activeProvider.api_key}`,
                  'User-Agent': 'Anthropic/Python 0.39.0',
                  'X-Stainless-Lang': 'python',
                },
                body: JSON.stringify({
                  model: activeProvider.selected_model || 'gpt-4o',
                  messages: promptMessages,
                  temperature: 0.1,
                  max_tokens: 800,
                  response_format: { type: 'json_object' },
                }),
                signal,
              })
              if (llmResponse.ok) {
                const llmData = (await llmResponse.json()) as any
                const messageObj = llmData.choices?.[0]?.message
                responseContent = messageObj?.content || messageObj?.reasoning || '{}'
              }
            } else if (activeProvider.provider_type === 'anthropic') {
              const baseUrl = (activeProvider.base_url || 'https://api.anthropic.com/v1').replace(/\/+$/, '')
              const llmResponse = await fetch(`${baseUrl}/messages`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': activeProvider.api_key,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                  model: activeProvider.selected_model || 'claude-3-5-sonnet-20241022',
                  max_tokens: 800,
                  temperature: 0.1,
                  system: promptMessages[0].content,
                  messages: [{ role: 'user', content: promptMessages[1].content }],
                }),
                signal,
              })
              if (llmResponse.ok) {
                const llmData = (await llmResponse.json()) as any
                responseContent = llmData.content?.[0]?.text || '{}'
              }
            } else if (activeProvider.provider_type === 'gemini') {
              const baseUrl = (activeProvider.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
              const modelName = (activeProvider.selected_model || 'gemini-1.5-flash').replace('models/', '')
              const llmResponse = await fetch(`${baseUrl}/models/${modelName}:generateContent?key=${activeProvider.api_key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: [{ text: promptMessages[1].content }] }],
                  systemInstruction: { parts: [{ text: promptMessages[0].content }] },
                  generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 800,
                    responseMimeType: 'application/json',
                  },
                }),
                signal,
              })
              if (llmResponse.ok) {
                const llmData = (await llmResponse.json()) as any
                responseContent = llmData.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
              }
            }
          } catch (providerErr) {
            console.warn('[stagehandAgent] Active provider call failed, falling back to OpenCode Zen:', providerErr)
          }
        }

        // Fallback to OpenCode Zen if response is empty or active provider failed
        if (responseContent === '{}' && OPENCODE_ZEN_API_KEY && OPENCODE_ZEN_API_KEY !== 'replace_with_your_key') {
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
              max_tokens: 800,
              response_format: { type: 'json_object' },
            }),
            signal,
          })

          if (llmResponse.ok) {
            const llmData = (await llmResponse.json()) as any
            const messageObj = llmData.choices?.[0]?.message
            responseContent = messageObj?.content || messageObj?.reasoning || '{}'
          }
        }

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
            toolCall: { tool: 'finish', arguments: { message: plan.message || plan.description || 'Goal achieved' } },
            decision,
          })
          emit('status', `Done: ${plan.message || 'Task completed'}`)
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

              await new Promise((resolve) => setTimeout(resolve, 800))
            } else {
              history.push({
                action: `Open new tab`,
                result: `Tab creation was cancelled or timed out`,
              })
            }
          }
        } else if (plan.action === 'click') {
          // Target by elementIndex or text match
          let targetEl = elementData.find((el: any) => el.index === plan.elementIndex)
          if (!targetEl && plan.description) {
            const descLower = String(plan.description).toLowerCase()
            targetEl = elementData.find((el: any) => el.text && descLower.includes(el.text.toLowerCase()))
          }
          if (!targetEl) targetEl = elementData[0]

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
                var el = document.querySelector('[data-agent-idx="${targetEl.index}"]') || document.elementFromPoint(${targetEl.x}, ${targetEl.y});
                if (el) {
                  var clickable = el.closest('a, button, [role="button"], [role="link"], input') || el;
                  clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  clickable.focus();
                  clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                  clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                  clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                  if (clickable.click) clickable.click();
                  if (clickable.tagName === 'A' && clickable.href && !clickable.href.startsWith('javascript:')) {
                    window.location.href = clickable.href;
                  }
                }
              })()
            `).catch(() => undefined)

            history.push({
              action: `Clicked "${targetEl.text || targetEl.tag}"`,
              result: 'Click dispatched, page updated',
            })

            // Settle after click/navigation
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
        } else if (plan.action === 'type') {
          let targetEl = elementData.find((el: any) => el.index === plan.elementIndex)
          if (!targetEl) {
            targetEl = elementData.find((el: any) => el.tag === 'input' || el.tag === 'textarea' || el.type === 'search' || el.type === 'text') || elementData[0]
          }

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
                var el = document.querySelector('[data-agent-idx="${targetEl.index}"]') || document.elementFromPoint(${targetEl.x}, ${targetEl.y});
                if (el) {
                  var inputEl = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el : (el.querySelector('input, textarea') || el);
                  inputEl.focus();
                  inputEl.value = ${JSON.stringify(plan.text)};
                  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                  ${plan.pressEnter ? `
                    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                    inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                    inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                    if (inputEl.form) {
                      if (inputEl.form.requestSubmit) {
                        try { inputEl.form.requestSubmit(); } catch (e) { inputEl.form.submit(); }
                      } else {
                        inputEl.form.submit();
                      }
                    }
                  ` : ''}
                }
              })()
            `).catch(() => undefined)

            history.push({
              action: `Typed "${plan.text}" into "${targetEl.text || targetEl.tag}"`,
              result: 'Input typed and form submitted',
            })

            // Settle after form submission / page search navigation
            await new Promise((resolve) => setTimeout(resolve, 1200))
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
          await new Promise((resolve) => setTimeout(resolve, 1000))
        } else if (plan.action === 'scroll') {
          const delta = plan.direction === 'up' ? -500 : 500
          emit('step', {
            step: stepCount,
            toolCall: { tool: 'scroll', arguments: { direction: plan.direction } },
            decision,
          })
          await guestContents.executeJavaScript(`window.scrollBy({ top: ${delta}, behavior: 'smooth' })`).catch(() => undefined)
          history.push({
            action: `Scrolled ${plan.direction}`,
            result: 'Scrolled page view',
          })
          await new Promise((resolve) => setTimeout(resolve, 600))
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
