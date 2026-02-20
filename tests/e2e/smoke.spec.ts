import { expect, test } from '@playwright/test'

test('TM1 e2e smoke', async ({ page }) => {
  await page.setContent('<main><h1>FormBuddy E2E Smoke</h1></main>')
  await expect(page.getByRole('heading', { name: 'FormBuddy E2E Smoke' })).toBeVisible()
})
