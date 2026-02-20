import { expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test'
import { installMockDirectoryPicker, launchExtensionHarness } from './helpers/extension'

test.describe('TM9 — E2E milestones 6-8 (detect -> suggest -> fill)', () => {
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

  async function openSidePanel(): Promise<Page> {
    const page = await context.newPage()
    await installMockDirectoryPicker(page)
    await page.addInitScript(() => {
      ;(window as unknown as { __FORMBUDDY_INDEX_OVERRIDE?: () => { status: 'indexed' } })
        .__FORMBUDDY_INDEX_OVERRIDE = () => ({ status: 'indexed' })
    })
    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
    await page.getByRole('button', { name: /Choose Folder/i }).click()
    await expect(page.getByText('sample-note.txt')).toBeVisible()
    return page
  }

  async function openFormPage(): Promise<Page> {
    const page = await context.newPage()
    await page.goto('https://example.com')
    await page.evaluate(() => {
      const label = document.createElement('label')
      label.htmlFor = 'passport-number'
      label.textContent = 'Passport Number'
      const input = document.createElement('input')
      input.id = 'passport-number'
      input.type = 'text'
      document.body.append(label, input)
    })
    return page
  }

  test('TM9.1 field focus updates activity and suggestion appears', async () => {
    const sidepanel = await openSidePanel()
    const formPage = await openFormPage()

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
        value: 'AB1234567',
        sourceFile: 'sample-note.txt',
        sourceText: 'Passport AB1234567',
        reason: 'Exact match from local context',
        confidence: 'high',
      }
    })

    await formPage.locator('#passport-number').focus()

    await expect(sidepanel.locator('li').filter({ hasText: 'Passport Number' }).first()).toBeVisible()
    await expect(sidepanel.getByText('AB1234567', { exact: true })).toBeVisible()
    await expect(sidepanel.getByText('From: sample-note.txt')).toBeVisible()
  })

  test('TM9.2 accept suggestion autofills field and suppresses repeat', async () => {
    const sidepanel = await openSidePanel()
    const formPage = await openFormPage()

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
        value: 'ZX9876543',
        sourceFile: 'sample-note.txt',
        sourceText: 'Passport ZX9876543',
        reason: 'Exact match from local context',
        confidence: 'high',
      }
    })

    await formPage.locator('#passport-number').focus()
    await expect(sidepanel.getByText('ZX9876543', { exact: true })).toBeVisible()

    // Keep the form tab active so AUTOFILL_FIELD targets the actual form tab.
    await formPage.bringToFront()
    await sidepanel.evaluate(() => {
      const accept = Array.from(document.querySelectorAll('button')).find(
        node => node.textContent?.trim() === 'Accept'
      ) as HTMLButtonElement | undefined
      accept?.click()
    })

    await expect(formPage.locator('#passport-number')).toHaveValue('ZX9876543')
    await expect(sidepanel.getByText(/Passport Number -> ZX9876543/)).toBeVisible()

    await formPage.locator('#passport-number').blur()
    await formPage.locator('#passport-number').focus()
    await expect(sidepanel.getByText(/From:\s+sample-note\.txt/)).toHaveCount(0)
  })
})
