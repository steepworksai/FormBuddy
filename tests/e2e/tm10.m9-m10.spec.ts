import { expect, test, type BrowserContext } from '@playwright/test'
import { installMockDirectoryPicker, launchExtensionHarness } from './helpers/extension'

test.describe('TM10 — E2E milestones 9-10 (session + screenshot)', () => {
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

  test('TM10.1 same-domain navigation increments page count, cross-domain resets', async () => {
    const sidepanel = await context.newPage()
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)

    const web = await context.newPage()
    await web.goto('https://example.com/form-a')
    await expect(sidepanel.getByText(/Session: Page 1 • example\.com/)).toBeVisible()

    await web.goto('https://example.com/form-b')
    await expect(sidepanel.getByText(/Session: Page 2 • example\.com/)).toBeVisible()

    await web.goto('https://example.org/next')
    await expect(sidepanel.getByText(/Session: Page 1 • example\.org/)).toBeVisible()
  })

  test('TM10.2 screenshot capture creates indexed screenshot file', async () => {
    const sidepanel = await context.newPage()
    await installMockDirectoryPicker(sidepanel)
    await sidepanel.addInitScript(() => {
      ;(window as unknown as { __FORMBUDDY_INDEX_OVERRIDE?: () => { status: 'indexed' } })
        .__FORMBUDDY_INDEX_OVERRIDE = () => ({ status: 'indexed' })
    })
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await sidepanel.locator('#fb-choose-folder').click()
    await expect(sidepanel.getByText('sample-note.txt')).toBeVisible()

    // Keep a normal webpage as the active tab so captureVisibleTab targets it.
    const web = await context.newPage()
    await web.goto('https://example.com/capture')
    await web.bringToFront()

    await sidepanel.getByRole('button', { name: /Capture screenshot/i }).click()

    await expect(sidepanel.getByText(/Screenshot indexed and ready/i)).toBeVisible()
    await expect(sidepanel.getByText(/screenshot-\d{4}-\d{2}-\d{2}-\d{4}\.png/)).toBeVisible()
  })
})
