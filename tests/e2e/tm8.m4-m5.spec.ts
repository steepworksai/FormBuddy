import path from 'node:path'
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'

test.describe('TM8 — E2E milestones 4-5 (provider setup)', () => {
  let context: BrowserContext
  let extensionId = ''

  test.beforeAll(async () => {
    const extensionPath = path.resolve(process.cwd(), 'dist')
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    })
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    extensionId = new URL(sw.url()).host
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

  test('TM8.1 provider list includes Anthropic, OpenAI, Gemini', async () => {
    const page = await openPopupWithOverride()

    const providerSelect = page.locator('select').first()
    await expect(providerSelect).toBeVisible()

    const options = await providerSelect.locator('option').allTextContents()
    expect(options).toContain('Anthropic Claude')
    expect(options).toContain('OpenAI')
    expect(options).toContain('Google Gemini')
  })

  test('TM8.2 verify success shows connected state', async () => {
    const page = await openPopupWithOverride('valid')
    await page.getByPlaceholder('Paste your API key here').fill('test-key')
    await page.getByRole('button', { name: 'Verify & Save' }).click()

    await expect(page.getByRole('button', { name: '✓ Connected' })).toBeVisible()
  })

  test('TM8.3 invalid key shows invalid message', async () => {
    const page = await openPopupWithOverride('invalid')
    await page.getByPlaceholder('Paste your API key here').fill('bad-key')
    await page.getByRole('button', { name: 'Verify & Save' }).click()

    await expect(page.getByText(/Invalid key/i)).toBeVisible()
  })

  test('TM8.4 network error shows error state', async () => {
    const page = await openPopupWithOverride('error')
    await page.getByPlaceholder('Paste your API key here').fill('key')
    await page.getByRole('button', { name: 'Verify & Save' }).click()

    await expect(page.getByText(/Network error/i)).toBeVisible()
  })
})
