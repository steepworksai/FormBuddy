import { defineConfig } from '@playwright/test'
import { loadLocalTestEnv, resolveTestDataDir } from './tests/utils/test-env'

const localEnv = loadLocalTestEnv()
const testDataDir = resolveTestDataDir()

if (localEnv.CLAUDE_API_KEY && !process.env.CLAUDE_API_KEY) {
  process.env.CLAUDE_API_KEY = localEnv.CLAUDE_API_KEY
}
if (!process.env.FORMBUDDY_TEST_DATA_DIR) {
  process.env.FORMBUDDY_TEST_DATA_DIR = testDataDir
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  metadata: {
    formbuddyTestDataDir: testDataDir,
  },
  use: {
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
