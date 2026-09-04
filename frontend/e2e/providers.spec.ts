import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test.describe('Multi-Provider Integration E2E Tests', () => {
  let electronApp: ElectronApplication
  let window: Page

  test.beforeAll(async () => {
    const cleanEnv = { ...process.env }
    delete cleanEnv.ELECTRON_RUN_AS_NODE

    electronApp = await electron.launch({
      args: [path.join(__dirname, '../dist-electron/main.js')],
      env: {
        ...cleanEnv,
        PROMPT_DEFENSE_DEV: 'false',
      },
    })

    window = await electronApp.firstWindow()
  })

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close()
    }
  })

  async function openBrowserShell() {
    const browserFrame = window.locator('.browser-frame')
    if (await browserFrame.isVisible()) return

    const startButton = window.locator('.start-button')
    await Promise.race([
      startButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
      browserFrame.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
    ])

    if (await startButton.isVisible()) {
      await startButton.click()
    }

    await expect(browserFrame).toBeVisible({ timeout: 15000 })
  }

  test('should display OpenRouter, TokenRouter, NaraRouter, and OpenAdapter in provider settings', async () => {
    await openBrowserShell()

    // Open the assistant panel if not already open
    const assistantPanel = window.locator('[aria-label="Kimo panel"]')
    if (!(await assistantPanel.isVisible())) {
      await window.locator('.assistant-pill').click()
      await expect(assistantPanel).toBeVisible({ timeout: 5000 })
    }

    // Click connect provider / model button scoped to chat form
    const modelBtn = assistantPanel.locator('.prompt-form .prompt-model-btn')
    await expect(modelBtn).toBeVisible({ timeout: 5000 })
    await modelBtn.click()

    const modal = window.locator('[role="dialog"]')
    // If a provider was already configured, clicking toggles the dropdown with "Manage Providers"
    if (!(await modal.isVisible())) {
      const manageBtn = assistantPanel.locator('.prompt-model-manage-btn')
      if (await manageBtn.isVisible()) {
        await manageBtn.click()
      }
    }
    await expect(modal).toBeVisible({ timeout: 5000 })

    // Verify all 4 new providers are present in the dialog (either connected or in popular)
    await expect(modal.locator('.oc-provider-name').filter({ hasText: 'OpenRouter' }).first()).toBeVisible()
    await expect(modal.locator('.oc-provider-name').filter({ hasText: 'TokenRouter' }).first()).toBeVisible()
    await expect(modal.locator('.oc-provider-name').filter({ hasText: 'NaraRouter' }).first()).toBeVisible()
    await expect(modal.locator('.oc-provider-name').filter({ hasText: 'OpenAdapter' }).first()).toBeVisible()

    // Test connectable popular providers
    const popularSection = modal.locator('.oc-section').filter({ hasText: 'Popular providers' })
    if (await popularSection.isVisible()) {
      const popularRows = popularSection.locator('.oc-provider-row')
      const count = await popularRows.count()
      for (let i = 0; i < count; i++) {
        const row = popularRows.nth(i)
        const name = await row.locator('.oc-provider-name').textContent()
        if (name?.includes('OpenRouter') || name?.includes('TokenRouter') || name?.includes('OpenAdapter')) {
          await row.locator('.oc-btn-connect').click()
          await expect(modal.locator('.oc-connect-title')).toBeVisible()
          if (name.includes('OpenRouter')) {
            await expect(modal.locator('select.oc-select')).toHaveValue('openrouter/auto')
            await expect(modal.locator('text=Auto-routing active')).toBeVisible()
          } else if (name.includes('TokenRouter')) {
            await expect(modal.locator('select.oc-select')).toHaveValue('z-ai/glm-5.3-free')
          }
          await modal.locator('.oc-btn-back').click()
        }
      }
    }

    // Close the settings modal
    await modal.locator('.oc-close-btn').click()
    await expect(modal).not.toBeVisible()

    // Open prompt model picker popover to verify TokenRouter has GLM 5.3 Free available
    await modelBtn.click()
    const popover = assistantPanel.locator('.prompt-model-popover')
    if (await popover.isVisible()) {
      // If TokenRouter is active or switchable, verify GLM 5.3 Free is listed
      const searchInput = popover.locator('.prompt-model-search')
      if (await searchInput.isVisible()) {
        await searchInput.fill('glm')
        const glmOption = popover.locator('.prompt-model-option').filter({ hasText: 'GLM 5.3 Free' })
        if (await glmOption.count() > 0) {
          await expect(glmOption.first()).toBeVisible()
          await expect(glmOption.first().locator('.prompt-model-free-badge')).toBeVisible()
        }
      }
      // Click outside / toggle again to close popover
      await modelBtn.click()
    }
  })
})
