import { expect, test, type BrowserContext, type Worker } from '@playwright/test'
import { installMockDirectoryPicker, launchExtensionHarness } from './helpers/extension'

test.describe('TM11 — E2E milestone 11 (quick add intake paths)', () => {
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

  test('TM11.1 drag-drop, quick note, and runtime quick-add all index into list', async () => {
    const sidepanel = await context.newPage()
    await installMockDirectoryPicker(sidepanel)
    await sidepanel.addInitScript(() => {
      ;(window as unknown as { __FORMBUDDY_INDEX_OVERRIDE?: () => { status: 'indexed' } })
        .__FORMBUDDY_INDEX_OVERRIDE = () => ({ status: 'indexed' })
    })

    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await sidepanel.getByRole('button', { name: /Choose Folder/i }).click()
    await expect(sidepanel.getByText('sample-note.txt')).toBeVisible()
    await sidepanel.waitForFunction(() => {
      return typeof (window as unknown as { __FORMBUDDY_TEST_DROP_FILES?: unknown }).__FORMBUDDY_TEST_DROP_FILES === 'function'
    })

    await sidepanel.evaluate(async () => {
      const file = new File(['drop content'], 'from-drop.txt', { type: 'text/plain' })
      await (window as unknown as { __FORMBUDDY_TEST_DROP_FILES?: (files: File[]) => Promise<void> })
        .__FORMBUDDY_TEST_DROP_FILES?.([file])
    })
    await expect(sidepanel.getByText('from-drop.txt')).toBeVisible()

    await sidepanel.getByPlaceholder('Add a note, number, or detail you want FormBuddy to use.').fill('My loyalty number is ABC-123-XYZ')
    await sidepanel.getByRole('button', { name: 'Save Note' }).click()
    await expect(sidepanel.getByText(/note-.*\.txt/)).toBeVisible()

    await serviceWorker.evaluate(() => {
      chrome.runtime.sendMessage({
        type: 'QUICK_ADD',
        payload: {
          content: 'Quick-add text from runtime message',
          tabUrl: 'https://example.com',
          createdAt: new Date().toISOString(),
        },
      })
    })

    await expect.poll(async () => await sidepanel.locator('li:has-text("note-")').count()).toBeGreaterThan(1)
  })
})
