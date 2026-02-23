#!/usr/bin/env node
/**
 * FormBuddy — End-to-End Pipeline Tester
 *
 * Simulates the complete FormBuddy indexing + field-mapping pipeline:
 *
 *   Phase 1 — Parse   : extract raw text from a PDF or image via LLM vision
 *   Phase 2 — Cleanup : de-noise and normalise raw text via LLM
 *   Phase 3 — Map     : map a list of form fields to extracted values
 *
 * Edit the CONFIG block below, then run:
 *   node scripts/test-e2e.mjs
 *
 * PDF support: Gemini and Anthropic read PDFs natively.
 * OpenAI does not — use an image file or switch provider for Phase 1.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

// ═══════════════════════════════════════════════════════════════
//  CONFIG — edit these values and hit Run
// ═══════════════════════════════════════════════════════════════

const FILE_PATH = '/Users/venkateshpoosarla/Documents/GitHub/FormBuddy/output/pdf/FAKE_DL.png'
const PROVIDER = 'gemini'            // 'gemini' | 'anthropic' | 'openai'
const MODEL = 'gemini-2.5-flash'

const FIELDS = `
Driver License Number
D123-4567-8901
Issuing State
CA
License Class
C
Issue Date
YYYY-MM-DD
Expiration Date
YYYY-MM-DD
Restrictions
NONE
Endorsements
M
Veteran Indicator
Select
Person Details
First Name
First name
Middle Name
Middle name
Last Name
Last name
Date of Birth
YYYY-MM-DD
Sex
Select
Height
5'11\
Weight
175 lb
Eye Color
BRO
Address
Address Line 1
123 Main St
Address Line 2
Apt, Suite (optional)
City
San Jose
State
CA
ZIP Code
`.trim()

// ═══════════════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Secrets ──────────────────────────────────────────────────
function loadSecrets() {
  const p = resolve(__dirname, '..', '.test-secrets.local')
  if (!existsSync(p)) return {}
  return Object.fromEntries(
    readFileSync(p, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  )
}
const secrets = loadSecrets()
const API_KEY =
  PROVIDER === 'anthropic' ? (secrets.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY) :
    PROVIDER === 'openai' ? (secrets.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY) :
      (secrets.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY)

if (!API_KEY) { console.error(`❌ No API key for provider "${PROVIDER}". Add to .test-secrets.local.`); process.exit(1) }
if (!existsSync(FILE_PATH)) { console.error(`❌ File not found: ${FILE_PATH}`); process.exit(1) }

// ─── MIME helpers ─────────────────────────────────────────────
const MIME_MAP = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.pdf': 'application/pdf',
}
const ext = extname(FILE_PATH).toLowerCase()
const mimeType = MIME_MAP[ext]
if (!mimeType) { console.error(`❌ Unsupported file type: ${ext}`); process.exit(1) }
const isPDF = mimeType === 'application/pdf'

// ─── Generic callLLM (text-only, all providers) ───────────────
async function callLLM(systemPrompt, userMessage) {
  if (PROVIDER === 'anthropic') {
    const client = new Anthropic({ apiKey: API_KEY })
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })
    return {
      text: res.content[0]?.type === 'text' ? res.content[0].text : '',
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    }
  }
  if (PROVIDER === 'openai') {
    const client = new OpenAI({ apiKey: API_KEY })
    const res = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })
    return {
      text: res.choices[0]?.message?.content ?? '',
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    }
  }
  // Gemini
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent` +
    `?key=${encodeURIComponent(API_KEY)}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const usage = data.usageMetadata
  return {
    text: (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join(''),
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  }
}

// ─── Prompts (mirroring src/lib/llm/) ─────────────────────────
const VISION_PROMPT =
  'Extract all visible text from this image exactly as it appears. ' +
  'Preserve every label, value, number, date, code, and identifier. ' +
  'Keep label/value pairs on separate lines. ' +
  'Do not rephrase, reformat, or omit anything. ' +
  'Return only the extracted text — no commentary, no markdown.'

const CLEANUP_SYSTEM_PROMPT = `You are a document text cleaner. You receive raw text extracted from a scanned image or PDF via OCR. The text may contain:
- Repeated or duplicate lines (e.g. watermarks printed multiple times)
- Layout noise such as stray characters or broken words
- Garbled characters from poor scan quality
- Irrelevant repeated headers or footers

Your task:
- Remove duplicate and noise lines
- Fix obvious OCR errors only when the correction is certain
- Preserve all labels, values, numbers, dates, codes, and identifiers exactly as they appear
- Keep the logical structure and reading order of the document
- Do not categorize, reformat, summarize, or restructure the content

Return only the cleaned text — no commentary, no markdown, no JSON.`


// Mirrors getManualFieldExtractionPrompt() in src/lib/llm/prompts.ts — keep in sync
const MAPPING_SYSTEM_PROMPT = `You are a document field extraction assistant.

You are given one or more personal documents (as cleanText) and a list of form fields to fill.
Read each document's cleanText and extract the best matching value for every field.

## RULES
- Split names correctly: 2 parts → First + Last; 3 parts → First + Middle + Last.
- Dates must be in YYYY-MM-DD format.
- Strip document-specific prefixes from identifiers when clearly present (e.g. "DL Y123" → "Y123").
- Parse addresses into individual components when the form asks for them (Line 1, City, State, ZIP).
- Disambiguate dates by context: past dates → issued / date of birth; future dates → expiry.
- For multi-document inputs, pick the most specific and confident value across all docs.
- If a value cannot be found in any document, return "Not Found".
- Never output placeholder values like "Select", "YYYY-MM-DD", or "123 Main St".
- Do not include explanations, markdown, tables, bullets, JSON, or extra lines.

## OUTPUT
Return ONLY key-value pairs, one per line, nothing else.
Field Name: Extracted Value`

// ─── Helpers ──────────────────────────────────────────────────
function stripFences(s) {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function parseKeyValues(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).flatMap(line => {
    const sep = line.indexOf(':')
    if (sep <= 0) return []
    const label = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (!label || !value || /^not found$/i.test(value)) return []
    return [{ label, value }]
  })
}

function printTable(rows) {
  if (!rows.length) { console.log('  (none)'); return }
  const w = Math.max(...rows.map(r => r.label.length), 10)
  for (const r of rows) console.log(`  ${r.label.padEnd(w)}  →  ${r.value}`)
}

function section(title) {
  const line = '─'.repeat(44)
  console.log(`\n${line}`)
  console.log(`  ${title}`)
  console.log(line)
}

let totalIn = 0, totalOut = 0

function trackUsage(label, usage) {
  totalIn += usage.inputTokens
  totalOut += usage.outputTokens
  console.log(`  [tokens]  in: ${usage.inputTokens}  out: ${usage.outputTokens}`)
}

// ─── Header ───────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════╗')
console.log('║   FormBuddy — End-to-End Pipeline Tester    ║')
console.log('╚══════════════════════════════════════════════╝')
console.log(`\n  File     : ${FILE_PATH.split('/').pop()}`)
console.log(`  Type     : ${mimeType}`)
console.log(`  Provider : ${PROVIDER}  /  ${MODEL}`)
console.log(`  API key  : ${API_KEY.slice(0, 8)}…${API_KEY.slice(-4)}`)
console.log(`  Fields   : ${FIELDS.split('\n').length}`)

// ══════════════════════════════════════════════════════════════
//  PHASE 1 — Parse: extract raw text via LLM vision
// ══════════════════════════════════════════════════════════════
section('Phase 1 — Parse  (LLM vision)')
const fileBytes = readFileSync(FILE_PATH)
const fileBase64 = fileBytes.toString('base64')
const fileSizeKB = (fileBytes.length / 1024).toFixed(1)
console.log(`  Size     : ${fileSizeKB} KB`)

let rawText = ''

const t1 = Date.now()
try {
  if (PROVIDER === 'anthropic') {
    const client = new Anthropic({ apiKey: API_KEY })
    const sourceType = isPDF ? 'base64' : 'base64'
    const mediaTypeField = isPDF ? 'application/pdf' : mimeType
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          isPDF
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
            : { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileBase64 } },
          { type: 'text', text: VISION_PROMPT },
        ],
      }],
    })
    rawText = res.content[0]?.type === 'text' ? res.content[0].text.trim() : ''
    trackUsage('parse', { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 })

  } else if (PROVIDER === 'openai') {
    if (isPDF) {
      console.log('  ⚠  OpenAI does not support native PDF reading. Set PROVIDER to gemini or anthropic for PDFs.')
      process.exit(1)
    }
    const client = new OpenAI({ apiKey: API_KEY })
    const res = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
          { type: 'text', text: VISION_PROMPT },
        ],
      }],
    })
    rawText = res.choices[0]?.message?.content?.trim() ?? ''
    trackUsage('parse', { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 })

  } else {
    // Gemini — supports both images and PDFs via inline_data
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent` +
      `?key=${encodeURIComponent(API_KEY)}`
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mimeType, data: fileBase64 } },
            { text: VISION_PROMPT },
          ],
        }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0 },
      }),
    })
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
    const data = await res.json()
    rawText = (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim()
    const usage = data.usageMetadata
    trackUsage('parse', { inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 })
  }
} catch (err) {
  console.error(`\n  ❌ Phase 1 failed: ${err.message}`)
  process.exit(1)
}

console.log(`  Time     : ${Date.now() - t1}ms`)
console.log('\n  Raw text extracted:')
console.log('  ' + rawText.replace(/\n/g, '\n  ').slice(0, 600) + (rawText.length > 600 ? '\n  …[truncated for display]' : ''))

// ══════════════════════════════════════════════════════════════
//  PHASE 2 — Cleanup: de-noise the raw text
//  Same step regardless of whether text came from PDF parsing or LLM vision.
// ══════════════════════════════════════════════════════════════
section('Phase 2 — Cleanup  (text de-noise)')

let cleanText = rawText   // fallback: use raw text if cleanup fails

const t2 = Date.now()
try {
  const userMsg = `Document: ${FILE_PATH.split('/').pop()}\n\nRaw text:\n${rawText.slice(0, 8000)}`
  const result = await callLLM(CLEANUP_SYSTEM_PROMPT, userMsg)
  trackUsage('cleanup', result)
  if (result.text.trim()) cleanText = result.text.trim()
} catch (err) {
  console.warn(`  ⚠  Text cleanup failed: ${err.message}  (using raw text)`)
}

console.log(`  Time     : ${Date.now() - t2}ms`)
console.log('\n  Cleaned text:')
console.log('  ' + cleanText.replace(/\n/g, '\n  ').slice(0, 400) + (cleanText.length > 400 ? '\n  …' : ''))

// ══════════════════════════════════════════════════════════════
//  PHASE 3 — Map: field mapping directly from cleanText
// ══════════════════════════════════════════════════════════════
section('Phase 3 — Map  (form field mapping)')

const fields = FIELDS.split('\n').map(f => f.trim()).filter(Boolean)
console.log(`  Mapping ${fields.length} fields:`)
fields.forEach((f, i) => console.log(`    ${String(i + 1).padStart(2)}. ${f}`))

const mappingPayload = {
  documents: [{
    fileName: FILE_PATH.split('/').pop(),
    cleanText,
  }],
  form_fields: fields.join('\n'),
}

let mappedFields = []
const t3 = Date.now()
try {
  const result = await callLLM(MAPPING_SYSTEM_PROMPT, JSON.stringify(mappingPayload, null, 2))
  trackUsage('map', result)
  mappedFields = parseKeyValues(result.text)
} catch (err) {
  console.error(`\n  ❌ Phase 3 failed: ${err.message}`)
}
console.log(`  Time     : ${Date.now() - t3}ms`)

// ══════════════════════════════════════════════════════════════
//  RESULTS
// ══════════════════════════════════════════════════════════════
section('Results')

if (!mappedFields.length) {
  console.log('  (no values mapped)')
} else {
  printTable(mappedFields)
  console.log(`\n  Filled ${mappedFields.length} / ${fields.length} fields`)

  // Coverage check
  const notFilled = fields.filter(f => !mappedFields.some(r => r.label.toLowerCase() === f.toLowerCase()))
  if (notFilled.length) {
    console.log(`\n  Not filled (${notFilled.length}):`)
    notFilled.forEach(f => console.log(`    - ${f}`))
  }
}

// ─── Token summary ────────────────────────────────────────────
console.log(`\n  Token usage across all phases:`)
console.log(`    Input  : ${totalIn}`)
console.log(`    Output : ${totalOut}`)
console.log(`    Total  : ${totalIn + totalOut}`)
console.log('\n' + '═'.repeat(46) + '\n')
