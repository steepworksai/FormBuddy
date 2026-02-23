#!/usr/bin/env node
/**
 * FormBuddy — LLM Prompt Runner
 *
 * Edit the CONFIG block below, then run this file directly from your IDE.
 * No CLI arguments needed.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

// ═══════════════════════════════════════════════════════════════
//  CONFIG — edit these values and hit Run
// ═══════════════════════════════════════════════════════════════

// Path to a <uuid>.json file inside your FormBuddy-DB/.indexing folder
const DOC_PATH = resolve(__dirname, '..', 'output', 'pdf', 'FormBuddy-DB', '.indexing', 'b9c94168-a656-479d-98b1-1e934fad6163.json')

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
`

const PROVIDER = 'anthropic'   // 'anthropic' | 'openai' | 'gemini'
const MODEL = 'claude-sonnet-4-6'

// ═══════════════════════════════════════════════════════════════

// ─── Load API key from .test-secrets.local ───────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const secretsPath = resolve(__dirname, '..', '.test-secrets.local')

function loadSecrets() {
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
const API_KEY =
  PROVIDER === 'anthropic' ? (secrets.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY) :
    PROVIDER === 'openai' ? (secrets.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY) :
      (secrets.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY)

if (!API_KEY) {
  console.error(`No API key found for provider "${PROVIDER}". Add it to .test-secrets.local.`)
  process.exit(1)
}

// ─── Load document ────────────────────────────────────────────
if (!existsSync(DOC_PATH)) {
  console.error(`Document not found: ${DOC_PATH}`)
  process.exit(1)
}
const doc = JSON.parse(readFileSync(DOC_PATH, 'utf8'))

// ─── Prompt (mirrors getManualFieldExtractionPrompt() in src/lib/llm/prompts.ts)
const SYSTEM_PROMPT = `You are a document field extraction assistant.

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

const fields = FIELDS.split('\n').map(f => f.trim()).filter(Boolean)

// Mirrors buildFormAutofillMapWithLLM() payload in src/lib/llm/formMapper.ts
const payload = {
  documents: [{ fileName: doc.fileName, cleanText: doc.cleanText ?? doc.rawText ?? doc.pages?.map(p => p.rawText).join('\n') ?? '' }],
  form_fields: fields.join('\n'),
}
const userMessage = JSON.stringify(payload, null, 2)

// ─── Print inputs ─────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════╗')
console.log('║     FormBuddy — LLM Prompt Runner   ║')
console.log('╚══════════════════════════════════════╝')
const docCleanText = doc.cleanText ?? doc.rawText ?? doc.pages?.map(p => p.rawText).join('\n') ?? ''
console.log(`\n📄 Document : ${doc.fileName}`)
console.log(`📝 cleanText: ${docCleanText.length} chars${doc.cleanText ? '' : ' (rawText fallback — run indexing with API key to generate cleanText)'}`)
console.log(`🤖 Provider : ${PROVIDER}  /  ${MODEL}`)
console.log(`🔑 API key  : ${API_KEY.slice(0, 12)}…`)
console.log(`\n── Fields requested (${fields.length}) ${'─'.repeat(20)}`)
fields.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. ${f}`))

console.log('\n── User message preview (first 800 chars) ─')
console.log(userMessage.slice(0, 800) + (userMessage.length > 800 ? '\n…[truncated]' : ''))

// ─── Call the LLM ─────────────────────────────────────────────
console.log('\n── Calling LLM … ───────────────────────')
const start = Date.now()
let rawText = ''
let inputTokens = 0
let outputTokens = 0

if (PROVIDER === 'anthropic') {
  const client = new Anthropic({ apiKey: API_KEY })
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  rawText = res.content[0]?.type === 'text' ? res.content[0].text : ''
  inputTokens = res.usage?.input_tokens ?? 0
  outputTokens = res.usage?.output_tokens ?? 0

} else if (PROVIDER === 'openai') {
  const client = new OpenAI({ apiKey: API_KEY })
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
  })
  rawText = res.choices[0]?.message?.content ?? ''
  inputTokens = res.usage?.prompt_tokens ?? 0
  outputTokens = res.usage?.completion_tokens ?? 0

} else {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent` +
    `?key=${encodeURIComponent(API_KEY)}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.1 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = await res.json()
  rawText = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
}

const durationMs = Date.now() - start

// ─── Results ──────────────────────────────────────────────────
console.log(`\n── Raw response  (${durationMs}ms) ──────────────`)
console.log(rawText || '(empty)')

const parsed = rawText
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean)
  .flatMap(line => {
    const sep = line.indexOf(':')
    if (sep <= 0) return []
    const label = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (!label || !value || /^not found$/i.test(value)) return []
    return [{ label, value }]
  })

console.log('\n── Parsed result ───────────────────────')
if (!parsed.length) {
  console.log('  (no values extracted)')
} else {
  const w = Math.max(...parsed.map(r => r.label.length), 12)
  for (const r of parsed) {
    console.log(`  ${r.label.padEnd(w)}  →  ${r.value}`)
  }
}

console.log(`\n── Token usage ─────────────────────────`)
console.log(`  Input : ${inputTokens}`)
console.log(`  Output: ${outputTokens}`)
console.log(`  Total : ${inputTokens + outputTokens}`)
console.log('\n────────────────────────────────────────\n')
