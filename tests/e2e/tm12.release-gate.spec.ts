import { expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test'
import { installMockDirectoryPicker, launchExtensionHarness } from './helpers/extension'

test.describe('TM12 — Release gate suite', () => {
  let context: BrowserContext
  let extensionId = ''
  let serviceWorker: Worker

  test.beforeAll(async () => {
    const harness = await launchExtensionHarness()
    context = harness.context
    extensionId = harness.extensionId
    serviceWorker = harness.serviceWorker
  })

  test.afterAll(async () => {
    await context.close()
  })

  async function openPopupWithOverride(override?: 'valid' | 'invalid' | 'error'): Promise<Page> {
    const page = await context.newPage()
    if (override) {
      await page.addInitScript((value) => {
        ;(window as unknown as { __FORMBUDDY_VERIFY_OVERRIDE?: string }).__FORMBUDDY_VERIFY_OVERRIDE = value
      }, override)
    }
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
    return page
  }

  test('TM12.2 negative: no key warning appears after folder setup', async () => {
    const sidepanel = await context.newPage()
    await installMockDirectoryPicker(sidepanel)
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await sidepanel.locator('#fb-choose-folder').click()

    await expect(sidepanel.getByText(/No API key set/i)).toBeVisible()
  })

  test('TM12.3 negative: invalid key and network error surfaced in popup', async () => {
    const invalid = await openPopupWithOverride('invalid')
    await invalid.getByPlaceholder('Paste your API key here').fill('bad-key')
    await invalid.getByRole('button', { name: 'Verify & Save' }).click()
    await expect(invalid.getByText(/Invalid key/i)).toBeVisible()

    const errored = await openPopupWithOverride('error')
    await errored.getByPlaceholder('Paste your API key here').fill('any-key')
    await errored.getByRole('button', { name: 'Verify & Save' }).click()
    await expect(errored.getByText(/Network error/i)).toBeVisible()
  })

  test('TM12.4 negative: folder permission loss shows actionable error', async () => {
    const sidepanel = await context.newPage()
    await sidepanel.addInitScript(() => {
      ;(window as unknown as { __FORMBUDDY_DISABLE_TOUR__?: boolean }).__FORMBUDDY_DISABLE_TOUR__ = true
      ;(window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => {
        throw new DOMException('Denied', 'NotAllowedError')
      }
    })
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await sidepanel.locator('#fb-choose-folder').click()

    await expect(sidepanel.getByText(/Folder permission denied/i)).toBeVisible()
  })

  test('TM12.5 negative: empty context state is explicit', async () => {
    const sidepanel = await context.newPage()
    await installMockDirectoryPicker(sidepanel, [])
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await sidepanel.locator('#fb-choose-folder').click()

    await expect(sidepanel.getByText(/No supported files in this folder yet/i)).toBeVisible()
  })
})
