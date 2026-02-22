#!/usr/bin/env node
/**
 * FormBuddy — Gemini API Key Verifier
 *
 * Edit the CONFIG block below, then run this file directly from your IDE.
 * No CLI arguments needed.
 *
 * Usage:
 *   node scripts/verify-gemini-key.mjs
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ═══════════════════════════════════════════════════════════════
//  CONFIG — edit these values and hit Run
// ═══════════════════════════════════════════════════════════════

const API_KEY = ''   // ← paste your Gemini key here, or leave blank to load from .test-secrets.local
const MODEL = 'gemini-2.5-flash'

// ═══════════════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Load key from .test-secrets.local if not set above ───────
function loadSecrets() {
  const secretsPath = resolve(__dirname, '..', '.test-secrets.local')
  if (!existsSync(secretsPath)) return {}
  return Object.fromEntries(
    readFileSync(secretsPath, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  )
}

const key = API_KEY.trim() || loadSecrets().GEMINI_API_KEY || process.env.GEMINI_API_KEY

if (!key) {
  console.error('❌ No API key found. Set API_KEY in the CONFIG block or add GEMINI_API_KEY to .test-secrets.local')
  process.exit(1)
}

console.log('\n╔══════════════════════════════════════╗')
console.log('║   FormBuddy — Gemini Key Verifier   ║')
console.log('╚══════════════════════════════════════╝')
console.log(`\n🔑 Key    : ${key.slice(0, 8)}…${key.slice(-4)}`)
console.log(`🤖 Model  : ${MODEL}`)
console.log('\n── Sending test request … ──────────────')

const endpoint =
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent` +
  `?key=${encodeURIComponent(key)}`

const start = Date.now()

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Reply with just the word: ok' }] }],
      generationConfig: { maxOutputTokens: 5 },
    }),
  })

  const duration = Date.now() - start
  const body = await response.json()

  if (!response.ok) {
    const msg = body?.error?.message ?? JSON.stringify(body)
    console.log(`\n❌ INVALID KEY (HTTP ${response.status})`)
    console.log(`   ${msg}`)
    process.exit(1)
  }

  const text = body?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '(empty)'

  console.log(`\n✅ KEY IS VALID  (${duration}ms)`)
  console.log(`   Model reply : "${text.trim()}"`)
  console.log(`\n── You're good to go! ──────────────────\n`)

} catch (err) {
  console.log(`\n⚠️  NETWORK ERROR`)
  console.log(`   ${err.message}`)
  console.log('\n   Check your internet connection and try again.\n')
  process.exit(1)
}
