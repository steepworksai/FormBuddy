import fs from 'node:fs'
import path from 'node:path'

export interface TestEnvConfig {
  FORMBUDDY_TEST_DATA_DIR?: string
  CLAUDE_API_KEY?: string
}

function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const idx = trimmed.indexOf('=')
  if (idx <= 0) return null
  const key = trimmed.slice(0, idx).trim()
  const value = trimmed.slice(idx + 1).trim()
  return [key, value]
}

export function loadLocalTestEnv(cwd = process.cwd()): TestEnvConfig {
  const file = path.join(cwd, '.test-secrets.local')
  if (!fs.existsSync(file)) return {}

  const content = fs.readFileSync(file, 'utf8')
  const env: TestEnvConfig = {}
  for (const line of content.split('\n')) {
    const parsed = parseLine(line)
    if (!parsed) continue
    const [key, value] = parsed
    if (key === 'FORMBUDDY_TEST_DATA_DIR') env.FORMBUDDY_TEST_DATA_DIR = value
    if (key === 'CLAUDE_API_KEY') env.CLAUDE_API_KEY = value
  }
  return env
}

export function resolveTestDataDir(cwd = process.cwd()): string {
  const local = loadLocalTestEnv(cwd)
  return (
    process.env.FORMBUDDY_TEST_DATA_DIR ||
    local.FORMBUDDY_TEST_DATA_DIR ||
    '/Users/venkateshpoosarla/Documents/FormBuddyDocs/'
  )
}
