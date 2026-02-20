#!/usr/bin/env node
/**
 * FormBuddy — Local LLM prompt tester
 *
 * Reads an indexed document from FormBuddy/ and runs the same
 * manual-field-extraction prompt used by the extension.
 *
 * Usage:
 *   node scripts/test-prompt.mjs --list
 *   node scripts/test-prompt.mjs --doc "W2" --fields "First Name, Employer, Wages"
 *   node scripts/test-prompt.mjs --doc /full/path/to/uuid.json --fields "..."
 *
 * Options:
 *   --list               Show all indexed documents and exit
 *   --doc   <name|path>  Filename substring OR full path to uuid.json
 *   --fields <string>    Comma/newline-separated field names
 *   --provider anthropic | openai | gemini  (default: anthropic)
 *   --model  <id>        Override model
 *   --api-key <key>      Override API key (auto-loaded from .test-secrets.local)
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')

// ─── Load .test-secrets.local ────────────────────────────────────────────────
function loadSecrets() {
  const secretsPath = join(PROJECT_ROOT, '.test-secrets.local')
  if (!existsSync(secretsPath)) return {}
  const lines = readFileSync(secretsPath, 'utf8').split('\n')
  return Object.fromEntries(
    lines
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split('=').map((p, i) => (i === 0 ? p.trim() : l.slice(l.indexOf('=') + 1).trim())))
      .filter(([k, v]) => k && v !== undefined)
  )
}

const secrets = loadSecrets()
const DATA_DIR = secrets.FORMBUDDY_TEST_DATA_DIR
const INDEXING_DIR = DATA_DIR ? join(DATA_DIR, 'FormBuddy') : null

// ─── CLI parsing ─────────────────────────────────────────────────────────────
function arg(name) {
  const idx = process.argv.indexOf(name)
  return idx !== -1 ? process.argv[idx + 1] : undefined
}
const hasFlag = name => process.argv.includes(name)

const provider  = arg('--provider') ?? 'anthropic'
const modelArg  = arg('--model')
const apiKeyArg = arg('--api-key')
const docArg    = arg('--doc')
const fieldsRaw = arg('--fields')

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai:    'gpt-4o',
  gemini:    'gemini-2.0-flash',
}
const model = modelArg ?? DEFAULT_MODELS[provider] ?? 'claude-sonnet-4-6'

const apiKey = apiKeyArg
  ?? (provider === 'anthropic' ? secrets.CLAUDE_API_KEY      ?? process.env.ANTHROPIC_API_KEY : undefined)
  ?? (provider === 'openai'    ? secrets.OPENAI_API_KEY      ?? process.env.OPENAI_API_KEY    : undefined)
  ?? (provider === 'gemini'    ? secrets.GEMINI_API_KEY      ?? process.env.GEMINI_API_KEY    : undefined)

// ─── --list: show available indexed documents ─────────────────────────────────
function loadIndexedDocs() {
  if (!INDEXING_DIR || !existsSync(INDEXING_DIR)) return []
  return readdirSync(INDEXING_DIR)
    .filter(f => f.endsWith('.json') && f !== 'manifest.json' && !f.includes('.search.'))
    .map(f => {
      try {
        const doc = JSON.parse(readFileSync(join(INDEXING_DIR, f), 'utf8'))
        return { file: f, path: join(INDEXING_DIR, f), fileName: doc.fileName ?? f, summary: doc.summary ?? '', pageCount: doc.pageCount ?? '?' }
      } catch { return null }
    })
    .filter(Boolean)
}

if (hasFlag('--list')) {
  const docs = loadIndexedDocs()
  if (!docs.length) {
    console.log('No indexed documents found in:', INDEXING_DIR ?? '(FORMBUDDY_TEST_DATA_DIR not set)')
    process.exit(0)
  }
  console.log(`\nIndexed documents in ${INDEXING_DIR}:\n`)
  for (const d of docs) {
    console.log(`  📄 ${d.fileName}`)
    console.log(`     UUID : ${d.file}`)
    console.log(`     Pages: ${d.pageCount}`)
    if (d.summary) console.log(`     Info : ${d.summary.slice(0, 120)}…`)
    console.log()
  }
  process.exit(0)
}

// ─── Validate required args ───────────────────────────────────────────────────
if (!docArg || !fieldsRaw) {
  console.error([
    '',
    'Usage:',
    '  node scripts/test-prompt.mjs --list',
    '  node scripts/test-prompt.mjs --doc "W2" --fields "First Name, Employer, Wages"',
    '',
    'Options:',
    '  --list               Show all indexed documents',
    '  --doc   <name|path>  Filename substring or full path to uuid.json',
    '  --fields <string>    Comma/newline-separated field names',
    '  --provider anthropic | openai | gemini  (default: anthropic)',
    '  --model  <id>        Override model',
    '  --api-key <key>      Override API key',
    '',
  ].join('\n'))
  process.exit(1)
}

if (!apiKey) {
  console.error(`No API key found. Add CLAUDE_API_KEY to .test-secrets.local or pass --api-key.`)
  process.exit(1)
}

// ─── Resolve document path ────────────────────────────────────────────────────
let docPath = docArg
if (!existsSync(docArg)) {
  // Treat as a filename substring — search INDEXING_DIR
  if (!INDEXING_DIR || !existsSync(INDEXING_DIR)) {
    console.error('FORMBUDDY_TEST_DATA_DIR not set in .test-secrets.local and --doc is not a valid path.')
    process.exit(1)
  }
  const docs = loadIndexedDocs()
  const match = docs.find(d => d.fileName.toLowerCase().includes(docArg.toLowerCase()))
  if (!match) {
    console.error(`No indexed document matching "${docArg}". Run --list to see available docs.`)
    process.exit(1)
  }
  docPath = match.path
  console.log(`\nResolved "${docArg}"  →  ${match.fileName}`)
}

// ─── Load document ────────────────────────────────────────────────────────────
let doc
try {
  doc = JSON.parse(readFileSync(docPath, 'utf8'))
} catch (err) {
  console.error('Failed to read document:', err.message)
  process.exit(1)
}

const fields = fieldsRaw.split(/,|\n/).map(f => f.trim()).filter(Boolean)

// ─── Prompt (mirrors getManualFieldExtractionPrompt in prompts.ts) ────────────
const SYSTEM_PROMPT = `You are a document field extraction assistant.

Given a parsed document JSON and a list of form fields, extract the correct value
for each field and return ONLY as key-value pairs.

## INPUT FORMAT
- REFERENCE JSON is provided as "reference_json".
- FORM FIELDS are provided as "form_fields".

## RULES
- Extract values from the JSON in this order: entities -> fields -> rawText.
- Split names correctly: 2 parts = First + Last, 3 parts = First + Middle + Last.
- Dates must be YYYY-MM-DD format.
- Strip prefixes from identifiers when clearly present (example: "DL Y123" -> "Y123").
- Parse addresses into individual components when requested (Line 1, City, State, ZIP).
- Disambiguate dates by context (past = issued/DOB, future = expiry).
- If a value is not found, return "Not Found".
- Never output placeholder values like "Select", "YYYY-MM-DD", or "123 Main St".
- Do not include explanations, markdown, tables, bullets, JSON, or extra lines.

## OUTPUT
Return ONLY key-value pairs, nothing else.
Field Name: Extracted Value`

const payload = {
  reference_json: [{ fileName: doc.fileName, document: doc }],
  form_fields: fields.join('\n'),
}
const userMessage = JSON.stringify(payload, null, 2)

// ─── Print inputs ─────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════╗')
console.log('║     FormBuddy — LLM Prompt Tester   ║')
console.log('╚══════════════════════════════════════╝')
console.log(`\n📄 Document : ${doc.fileName}`)
console.log(`🤖 Provider : ${provider}  /  ${model}`)
console.log(`🔑 API key  : ${apiKey.slice(0, 12)}…`)
console.log(`\n── Fields requested (${fields.length}) ${'─'.repeat(20)}`)
fields.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. ${f}`))

console.log('\n── System prompt ───────────────────────')
console.log(SYSTEM_PROMPT)

console.log('\n── User message (first 1000 chars) ─────')
const preview = userMessage.length > 1000
  ? userMessage.slice(0, 1000) + '\n…[truncated — full doc passed to model]'
  : userMessage
console.log(preview)

// ─── Call the LLM ────────────────────────────────────────────────────────────
console.log('\n── Calling LLM … ───────────────────────')
const start = Date.now()
let rawText = ''
let inputTokens = 0
let outputTokens = 0

try {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    rawText = res.content[0]?.type === 'text' ? res.content[0].text : ''
    inputTokens  = res.usage?.input_tokens  ?? 0
    outputTokens = res.usage?.output_tokens ?? 0

  } else if (provider === 'openai') {
    const client = new OpenAI({ apiKey })
    const res = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
    })
    rawText = res.choices[0]?.message?.content ?? ''
    inputTokens  = res.usage?.prompt_tokens     ?? 0
    outputTokens = res.usage?.completion_tokens ?? 0

  } else {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`
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
} catch (err) {
  console.error('\n❌ LLM call failed:', err.message)
  process.exit(1)
}

const durationMs = Date.now() - start

// ─── Raw response ─────────────────────────────────────────────────────────────
console.log(`\n── Raw response  (${durationMs}ms) ──────────────`)
console.log(rawText || '(empty)')

// ─── Parse & display ──────────────────────────────────────────────────────────
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

if (inputTokens || outputTokens) {
  console.log(`\n── Token usage ─────────────────────────`)
  console.log(`  Input : ${inputTokens}`)
  console.log(`  Output: ${outputTokens}`)
  console.log(`  Total : ${inputTokens + outputTokens}`)
}

console.log('\n────────────────────────────────────────\n')
