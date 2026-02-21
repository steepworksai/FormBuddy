import { expect, test, type BrowserContext } from '@playwright/test'
import { installMockDirectoryPicker, launchExtensionHarness } from './helpers/extension'

/**
 * TM13 — Scan & Auto Fill UI flow
 *
 * These tests verify the Scan & Auto Fill surface end-to-end:
 *   1. The action button is visible after a folder is connected.
 *   2. Clicking it on an extension-URL context shows the "Cannot scan" error.
 */
test.describe('TM13 — Scan & Auto Fill flow', () => {
  let context: BrowserContext
  let extensionId = ''

  test.beforeAll(async () => {
    const harness = await launchExtensionHarness()
    context = harness.context
    extensionId = harness.extensionId
  })

  test.afterAll(async () => {
    await context.close()
  })

  test('TM13.1 Scan & Auto Fill button is visible after folder connection', async () => {
    const sidepanel = await context.newPage()
    await installMockDirectoryPicker(sidepanel)
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)

    // Folder not yet connected — button must not exist yet
    await expect(sidepanel.locator('#fb-scan-btn')).not.toBeVisible()

    await sidepanel.locator('#fb-choose-folder').click()
    // After indexing completes the fill section appears
    await expect(sidepanel.locator('#fb-fill-section')).toBeVisible({ timeout: 15_000 })
    await expect(sidepanel.locator('#fb-scan-btn')).toBeVisible()
  })

  test('TM13.2 clicking Scan & Auto Fill on an extension page shows actionable error', async () => {
    const sidepanel = await context.newPage()
    await installMockDirectoryPicker(sidepanel)
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await sidepanel.locator('#fb-choose-folder').click()
    await expect(sidepanel.locator('#fb-scan-btn')).toBeVisible({ timeout: 15_000 })

    await sidepanel.locator('#fb-scan-btn').click()

    // The active "tab" is the extension page itself so background returns the
    // "Cannot scan browser internal pages" error.
    await expect(
      sidepanel.getByText(/Cannot scan browser internal pages/i)
    ).toBeVisible({ timeout: 10_000 })
  })

})
