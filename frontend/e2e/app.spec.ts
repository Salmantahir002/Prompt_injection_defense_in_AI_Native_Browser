import { _electron as electron, test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test.describe('Prompt Defense Application E2E tests', () => {
  let electronApp: any
  let window: any

  test.beforeAll(async () => {
    // Launch the Electron application pointing to the compiled main.js
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main.js')],
      env: {
        PROMPT_DEFENSE_DEV: 'false', // Run in production-like mode so it loads dist/index.html
        ...process.env,
      },
    })

    // Wait for the first window to open
    window = await electronApp.firstWindow()
  })

  test.afterAll(async () => {
    // Clean up and close the Electron application
    if (electronApp) {
      await electronApp.close()
    }
  })

  async function openBrowserShell() {
    const startButton = window.locator('.start-button')
    if (await startButton.isVisible()) {
      await startButton.click()
    }

    await expect(window.locator('.browser-frame')).toBeVisible()
  }

  test('should load startup screen correctly', async () => {
    // Verify window title
    expect(await window.title()).toBe('Prompt Defense')

    // Verify the welcome screen header
    const welcomeTitle = window.locator('.welcome-title')
    await expect(welcomeTitle).toBeVisible()
    await expect(welcomeTitle).toHaveText('Welcome to Prompt Defense')

    // Verify presence of solar system animations and the Get started button
    const solarSystem = window.locator('.solar-system')
    await expect(solarSystem).toBeVisible()

    const startButton = window.locator('.start-button')
    await expect(startButton).toBeVisible()
    await expect(startButton).toContainText('Get started')
  })

  test('should transition to browser shell on clicking Get started', async () => {
    await openBrowserShell()

    const toolbar = window.locator('[aria-label="Browser toolbar"]')
    await expect(toolbar).toBeVisible()
  })

  test('should display default toolbar state and initial address value', async () => {
    await openBrowserShell()

    // A new tab deliberately starts with an empty address field.
    const addressInput = window.locator('input[aria-label="URL"]')
    await expect(addressInput).toBeVisible()
    await expect(addressInput).toHaveValue('')

    // Back, Forward and Reload buttons should render
    await expect(window.locator('button[aria-label="Back"]')).toBeVisible()
    await expect(window.locator('button[aria-label="Forward"]')).toBeVisible()
    await expect(window.locator('button[aria-label="Reload"]')).toBeVisible()

    // Scan and Assistant buttons should render
    await expect(window.locator('.scan-button')).toBeVisible()
    await expect(window.locator('.assistant-pill')).toBeVisible()
  })

  test('should toggle AI Assistant Sidebar correctly', async () => {
    await openBrowserShell()

    // Assert assistant panel is not visible initially
    const assistantPanel = window.locator('[aria-label="Kimo panel"]')
    await expect(assistantPanel).not.toBeVisible()

    // Click the assistant toggle button in the toolbar
    const assistantPill = window.locator('.assistant-pill')
    await assistantPill.click()

    // Assert that the sidebar slides into view
    await expect(assistantPanel).toBeVisible()

    // Check that the sidebar welcome message renders
    const sidebarTitle = assistantPanel.locator('h3')
    await expect(sidebarTitle).toHaveText('Kimo')

    const welcomeText = assistantPanel.locator('.assistant-welcome p')
    await expect(welcomeText).toContainText('personal prompt-defense assistant')

    // Toggle it back off
    await assistantPill.click()
    await expect(assistantPanel).not.toBeVisible()
  })
})
