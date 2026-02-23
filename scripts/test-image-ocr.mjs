#!/usr/bin/env node
/**
 * FormBuddy — Image OCR Tester
 *
 * Sends an image file (PNG, JPG, WEBP) to Gemini and extracts all text.
 * Edit the CONFIG block below, then run from your IDE.
 *
 * Usage:
 *   node scripts/test-image-ocr.mjs
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname, extname } from 'path'
import { fileURLToPath } from 'url'

// ═══════════════════════════════════════════════════════════════
//  CONFIG — edit these values and hit Run
// ═══════════════════════════════════════════════════════════════

const IMAGE_PATH = '/Users/venkateshpoosarla/Documents/GitHub/FormBuddy/output/pdf/FAKE_DL.png'   // ← paste your image path here, e.g. '/Users/you/Downloads/licence.png'
const MODEL = 'gemini-2.5-flash'

// ═══════════════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Load API key from .test-secrets.local ────────────────────
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

const secrets = loadSecrets()
const API_KEY = secrets.GEMINI_API_KEY || process.env.GEMINI_API_KEY

if (!API_KEY) {
  console.error('❌ No GEMINI_API_KEY found in .test-secrets.local')
  process.exit(1)
}

if (!IMAGE_PATH) {
  console.error('❌ Set IMAGE_PATH in the CONFIG block')
  process.exit(1)
}

if (!existsSync(IMAGE_PATH)) {
  console.error(`❌ File not found: ${IMAGE_PATH}`)
  process.exit(1)
}

// ─── Detect MIME type from extension ─────────────────────────
const ext = extname(IMAGE_PATH).toLowerCase()
const MIME_MAP = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const mimeType = MIME_MAP[ext]

if (!mimeType) {
  console.error(`❌ Unsupported file type: ${ext}  (supported: .png .jpg .jpeg .webp)`)
  process.exit(1)
}

// ─── Read image as base64 ─────────────────────────────────────
const imageBase64 = readFileSync(IMAGE_PATH).toString('base64')
const fileSizeKB = (readFileSync(IMAGE_PATH).length / 1024).toFixed(1)

console.log('\n╔══════════════════════════════════════╗')
console.log('║   FormBuddy — Image OCR Tester      ║')
console.log('╚══════════════════════════════════════╝')
console.log(`\n🖼️  File   : ${IMAGE_PATH.split('/').pop()}`)
console.log(`📦 Size   : ${fileSizeKB} KB`)
console.log(`🗂️  Type   : ${mimeType}`)
console.log(`🤖 Model  : ${MODEL}`)
console.log(`🔑 Key    : ${API_KEY.slice(0, 8)}…${API_KEY.slice(-4)}`)
console.log('\n── Sending to Gemini … ─────────────────')

const endpoint =
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent` +
  `?key=${encodeURIComponent(API_KEY)}`

const SYSTEM_PROMPT =
  'Extract all visible text from this image exactly as it appears. ' +
  'Preserve every label, value, number, date, code, and identifier. ' +
  'Keep label/value pairs on separate lines. ' +
  'Do not rephrase, reformat, or omit anything. ' +
  'Return only the extracted text — no commentary, no markdown.'

const start = Date.now()

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: SYSTEM_PROMPT },
        ],
      }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0 },
    }),
  })

  const duration = Date.now() - start
  const body = await response.json()

  if (!response.ok) {
    const msg = body?.error?.message ?? JSON.stringify(body)
    console.log(`\n❌ API ERROR (HTTP ${response.status}): ${msg}\n`)
    process.exit(1)
  }

  const rawText = (body?.candidates?.[0]?.content?.parts ?? [])
    .map(p => p.text ?? '').join('')

  console.log(`\n── Extracted text  (${duration}ms) ──────────────`)
  console.log(rawText.trim() || '(empty — no text detected)')

  const usage = body?.usageMetadata
  if (usage) {
    console.log('\n── Token usage ─────────────────────────')
    console.log(`  Input : ${usage.promptTokenCount ?? '?'}`)
    console.log(`  Output: ${usage.candidatesTokenCount ?? '?'}`)
  }

  console.log('\n────────────────────────────────────────\n')

} catch (err) {
  console.log(`\n⚠️  NETWORK ERROR: ${err.message}\n`)
  process.exit(1)
}
