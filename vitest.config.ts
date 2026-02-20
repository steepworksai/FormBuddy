import { defineConfig } from 'vitest/config'
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
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['tests/setup/unit.setup.ts'],
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    env: {
      FORMBUDDY_TEST_DATA_DIR: process.env.FORMBUDDY_TEST_DATA_DIR,
    },
  },
})
