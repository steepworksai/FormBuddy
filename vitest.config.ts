import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['tests/setup/unit.setup.ts'],
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
  },
})
