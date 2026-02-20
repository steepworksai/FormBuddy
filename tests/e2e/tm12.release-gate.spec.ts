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

  test('TM12.1 happy path: setup -> suggest -> accept -> navigation continuity', async () => {
    const sidepanel = await context.newPage()
    await installMockDirectoryPicker(sidepanel, [{ name: 'passport-note.txt', content: 'Passport QW1234567' }])
    await sidepanel.addInitScript(() => {
      ;(window as unknown as { __FORMBUDDY_INDEX_OVERRIDE?: () => { status: 'indexed' } })
        .__FORMBUDDY_INDEX_OVERRIDE = () => ({ status: 'indexed' })
    })
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await sidepanel.getByRole('button', { name: /Choose Folder/i }).click()
    await expect(sidepanel.getByText('passport-note.txt')).toBeVisible()

    await serviceWorker.evaluate(() => {
      ;(globalThis as unknown as {
        __FORMBUDDY_SUGGESTION_OVERRIDE?: {
          fieldId: string
          fieldLabel: string
          value: string
          sourceFile: string
          sourceText: string
          reason: string
          confidence: 'high'
        }
      }).__FORMBUDDY_SUGGESTION_OVERRIDE = {
        fieldId: 'passport-number',
        fieldLabel: 'Passport Number',
        value: 'QW1234567',
        sourceFile: 'passport-note.txt',
        sourceText: 'Passport QW1234567',
        reason: 'Matched passport note',
        confidence: 'high',
      }
    })

    const web = await context.newPage()
    await web.goto('https://example.com/apply')
    await web.evaluate(() => {
      const label = document.createElement('label')
      label.htmlFor = 'passport-number'
      label.textContent = 'Passport Number'
      const input = document.createElement('input')
      input.id = 'passport-number'
      document.body.append(label, input)
    })

    await web.locator('#passport-number').focus()
    await expect(sidepanel.getByText('QW1234567', { exact: true })).toBeVisible()

    await web.bringToFront()
    await sidepanel.evaluate(() => {
      const accept = Array.from(document.querySelectorAll('button')).find(
        node => node.textContent?.trim() === 'Accept'
      ) as HTMLButtonElement | undefined
      accept?.click()
    })
    await expect(web.locator('#passport-number')).toHaveValue('QW1234567')

    await web.goto('https://example.com/review')
    await expect(sidepanel.getByText(/Session: Page 2 • example\.com/)).toBeVisible()
  })

  test('TM12.2 negative: no key warning appears after folder setup', async () => {
    const sidepanel = await context.newPage()
    await installMockDirectoryPicker(sidepanel)
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await sidepanel.getByRole('button', { name: /Choose Folder/i }).click()

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
      ;(window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => {
        throw new DOMException('Denied', 'NotAllowedError')
      }
    })
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await sidepanel.getByRole('button', { name: /Choose Folder/i }).click()

    await expect(sidepanel.getByText(/Folder permission denied/i)).toBeVisible()
  })

  test('TM12.5 negative: empty context state is explicit', async () => {
    const sidepanel = await context.newPage()
    await installMockDirectoryPicker(sidepanel, [])
    await sidepanel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await sidepanel.getByRole('button', { name: /Choose Folder/i }).click()

    await expect(sidepanel.getByText(/No supported files in this folder yet/i)).toBeVisible()
    await expect(sidepanel.getByText(/Suggestions will appear when a field matches/i)).toBeVisible()
  })
})
