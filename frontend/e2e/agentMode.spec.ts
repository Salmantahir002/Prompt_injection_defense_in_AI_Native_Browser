import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Exercises the Browser Runtime and agent mode against a real Chromium page.
 *
 * Everything below the UI has previously only been covered by mocks. These
 * tests drive the actual CDP path — real accessibility tree, real native input
 * events — which is the only way to catch the class of bug that mocks cannot:
 * coordinates that resolve to the wrong node, key events a page ignores,
 * waits that never settle.
 *
 * The page under test is a data: URL so the suite needs no network or fixture
 * server, and stays deterministic.
 */

const TEST_PAGE = `data:text/html,${encodeURIComponent(`
<!doctype html><html><body style="font-family:sans-serif;padding:20px">
  <h1>Runtime Test Page</h1>
  <label for="q">Search</label>
  <input id="q" type="search" aria-label="Search" />
  <button id="go" onclick="document.getElementById('out').textContent='clicked:'+document.getElementById('q').value">Run search</button>
  <button id="danger">Delete account</button>
  <p id="out"></p>
  <div style="height:1500px"></div>
  <a href="#bottom" id="bottom-link">Bottom link</a>
</body></html>`)}`

type RuntimeResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

test.describe('Browser Runtime over real CDP', () => {
  let app: ElectronApplication
  let window: Page

  test.beforeAll(async () => {
    // See app.spec.ts: electron.exe behaves as plain Node when this is set,
    // and then rejects the Chromium switches Playwright needs.
    const cleanEnv = { ...process.env }
    delete cleanEnv.ELECTRON_RUN_AS_NODE

    app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main.js')],
      env: { ...cleanEnv, PROMPT_DEFENSE_DEV: 'false' },
    })
    window = await app.firstWindow()

    await window.locator('.start-button').click()
    await expect(window.locator('.browser-frame')).toBeVisible()
  })

  test.afterAll(async () => {
    await app?.close()
  })

  /** Reads the active tab's runtime target id off the container BrowserWebView.tsx tags with it. */
  async function activeTargetId(): Promise<number> {
    return await window.evaluate(() => {
      const container = document.querySelector('.browser-webview[data-webcontents-id]') as HTMLElement
      return Number(container.dataset.webcontentsId)
    })
  }

  /** Loads the fixture page into the active tab and returns its runtime target id. */
  async function loadTestPage(): Promise<number> {
    const targetId = await activeTargetId()
    await window.evaluate(
      ([id, url]) => window.electronAPI!.browser.navigate(id as number, url as string),
      [targetId, TEST_PAGE] as const,
    )

    // Wait for the runtime to report the page, rather than sleeping.
    await expect.poll(async () => {
      return await window.evaluate(async (id) => {
        const described = await window.electronAPI!.runtimeInvoke({
          targetId: id, name: 'describeTarget', params: {},
        }) as RuntimeResult<{ url: string }>
        return described.ok && described.data.url.startsWith('data:') ? id : null
      }, targetId)
    }, { timeout: 20000 }).not.toBeNull()

    return targetId
  }

  async function invoke<T>(targetId: number, name: string, params: Record<string, unknown> = {}) {
    return await window.evaluate(
      ([id, command, args]) => window.electronAPI!.runtimeInvoke({
        targetId: id as number, name: command as string, params: args as Record<string, unknown>,
      }) as Promise<unknown>,
      [targetId, name, params] as const,
    ) as RuntimeResult<T>
  }

  test('extracts semantic state from the real accessibility tree', async () => {
    const targetId = await loadTestPage()
    const state = await invoke<{
      url: string
      elements: { id: string; role: string; name: string }[]
    }>(targetId, 'extractPageState')

    expect(state.ok).toBe(true)
    if (!state.ok) return

    const roles = state.data.elements.map((element) => element.role)
    // Chromium's own AX computation must be producing real controls here.
    expect(roles).toContain('button')
    expect(state.data.elements.some((element) => element.name.includes('Run search'))).toBe(true)
    expect(state.data.elements.some((element) => /searchbox|textbox|combobox/.test(element.role))).toBe(true)
    // Decorative content must not leak into the planner's view.
    expect(roles).not.toContain('StaticText')
    expect(roles).not.toContain('paragraph')
  })

  test('fills a field with native key events and verifies the value landed', async () => {
    const targetId = await loadTestPage()
    const state = await invoke<{ elements: { id: string; role: string; name: string }[] }>(targetId, 'extractPageState')
    expect(state.ok).toBe(true)
    if (!state.ok) return

    const field = state.data.elements.find((element) => /searchbox|textbox|combobox/.test(element.role))
    expect(field, 'no text field found in semantic state').toBeTruthy()

    const filled = await invoke<{ verification: { verified: boolean; reason: string } }>(
      targetId, 'fill', { elementId: field!.id, value: 'hello agent' },
    )
    expect(filled.ok).toBe(true)
    if (!filled.ok) return
    expect(filled.data.verification.verified, filled.data.verification.reason).toBe(true)

    // And the page really received it, not just the accessibility layer.
    const value = await window.evaluate(
      (id) => window.electronAPI!.browser.executeJavaScript(id, 'document.getElementById("q").value'),
      targetId,
    )
    expect(value).toBe('hello agent')
  })

  test('clicks a real button and the page handler runs', async () => {
    const targetId = await loadTestPage()
    let state = await invoke<{ elements: { id: string; role: string; name: string }[] }>(targetId, 'extractPageState')
    expect(state.ok).toBe(true)
    if (!state.ok) return

    const field = state.data.elements.find((element) => /searchbox|textbox|combobox/.test(element.role))!
    await invoke(targetId, 'fill', { elementId: field.id, value: 'shoes' })

    state = await invoke<{ elements: { id: string; role: string; name: string }[] }>(targetId, 'extractPageState')
    if (!state.ok) return
    const button = state.data.elements.find((element) => element.name.includes('Run search'))!

    const clicked = await invoke<{ verification: { verified: boolean } }>(targetId, 'click', { elementId: button.id })
    expect(clicked.ok).toBe(true)

    // The click must have run the page's own onclick handler.
    const output = await window.evaluate(
      (id) => window.electronAPI!.browser.executeJavaScript(id, 'document.getElementById("out").textContent'),
      targetId,
    )
    expect(output).toBe('clicked:shoes')
  })

  test('scrolls with a native wheel event and verification sees the viewport move', async () => {
    const targetId = await loadTestPage()
    const scrolled = await invoke<{ verification: { verified: boolean; scrollChanged: boolean } }>(
      targetId, 'scroll', { deltaY: 600 },
    )
    expect(scrolled.ok).toBe(true)
    if (!scrolled.ok) return
    expect(scrolled.data.verification.scrollChanged).toBe(true)
    expect(scrolled.data.verification.verified).toBe(true)
  })

  test('captures a screenshot of the real page', async () => {
    const targetId = await loadTestPage()
    const shot = await invoke<{ format: string; dataBase64: string }>(targetId, 'captureScreenshot', {})
    expect(shot.ok).toBe(true)
    if (!shot.ok) return
    expect(shot.data.format).toBe('png')
    // A real PNG, not an empty string: iVBORw0KGgo is the PNG magic in base64.
    expect(shot.data.dataBase64.startsWith('iVBORw0KGgo')).toBe(true)
  })

  test('captures a deep security snapshot for the agent scan', async () => {
    const targetId = await loadTestPage()
    const snapshot = await invoke<{ visible_text: string; url: string }>(targetId, 'captureSecuritySnapshot', {})
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return
    expect(snapshot.data.visible_text).toContain('Runtime Test Page')
  })

  test('refuses javascript: navigation', async () => {
    const targetId = await loadTestPage()
    const blocked = await invoke(targetId, 'navigate', { url: 'javascript:alert(1)' })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.error.code).toBe('NAVIGATION_BLOCKED')
  })

  test('reports a stale element id rather than clicking the wrong node', async () => {
    const targetId = await loadTestPage()
    const stale = await invoke(targetId, 'click', { elementId: 'e9999' })
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.error.code).toBe('ELEMENT_NOT_FOUND')
  })
})

test.describe('Agent mode UI', () => {
  let app: ElectronApplication
  let window: Page

  test.beforeAll(async () => {
    const cleanEnv = { ...process.env }
    delete cleanEnv.ELECTRON_RUN_AS_NODE
    app = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main.js')],
      env: { ...cleanEnv, PROMPT_DEFENSE_DEV: 'false' },
    })
    window = await app.firstWindow()
    await window.locator('.start-button').click()
    await expect(window.locator('.browser-frame')).toBeVisible()
    await window.locator('.assistant-pill').click()
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('offers chat and agent as separate modes, with chat first', async () => {
    const panel = window.locator('[aria-label="Kimo panel"]')
    await expect(panel).toBeVisible()

    const chatTab = panel.locator('.assistant-mode-tab', { hasText: 'Chat' })
    const agentTab = panel.locator('.assistant-mode-tab', { hasText: 'Agent' })
    await expect(chatTab).toHaveAttribute('aria-selected', 'true')
    await expect(agentTab).toHaveAttribute('aria-selected', 'false')
  })

  test('switching to agent mode reveals the goal composer', async () => {
    const panel = window.locator('[aria-label="Kimo panel"]')
    await panel.locator('.assistant-mode-tab', { hasText: 'Agent' }).click()

    await expect(panel.locator('[aria-label="Agent mode"]')).toBeVisible()
    await expect(panel.locator('.agent-goal-input')).toBeVisible()
    await expect(panel.locator('.agent-run-button')).toBeDisabled()

    await panel.locator('.agent-goal-input').fill('find the cheapest flight')
    await expect(panel.locator('.agent-run-button')).toBeEnabled()
  })

  test('switching to chat hides agent mode without discarding its state', async () => {
    const panel = window.locator('[aria-label="Kimo panel"]')

    await panel.locator('.assistant-mode-tab', { hasText: 'Agent' }).click()
    await panel.locator('.agent-goal-input').fill('a goal that should persist')

    await panel.locator('.assistant-mode-tab', { hasText: 'Chat' }).click()
    await expect(panel.locator('.agent-goal-input')).not.toBeVisible()
    await expect(panel.locator('.chat-input-area')).toBeVisible()

    // The panel is hidden, not unmounted: a running task and a half-written
    // goal must survive a glance at the chat tab.
    await panel.locator('.assistant-mode-tab', { hasText: 'Agent' }).click()
    await expect(panel.locator('.agent-goal-input')).toHaveValue('a goal that should persist')
  })

  test('the manual Scan Page button is still available in agent mode', async () => {
    const panel = window.locator('[aria-label="Kimo panel"]')
    await panel.locator('.assistant-mode-tab', { hasText: 'Agent' }).click()

    // The manual workflow is independent of the agent and must not be hidden
    // or disabled by it.
    await expect(window.locator('.scan-button')).toBeVisible()
    await expect(window.locator('.scan-button')).toBeEnabled()
  })
})
