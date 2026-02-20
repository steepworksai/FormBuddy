import { callLLM } from './index'
import { SEARCH_INDEX_PROMPT } from './prompts'
import type { FieldEntry, LLMConfig, SearchIndexFile, SearchIndexItem } from '../../types'

const MAX_TEXT_CHARS = 12000
const MAX_ITEMS = 120

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeAliases(aliases: unknown): string[] {
  if (!Array.isArray(aliases)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of aliases) {
    const alias = normalize(String(value ?? ''))
    if (!alias) continue
    const key = alias.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(alias)
  }
  return result
}

function normalizeAutofill(autofill: unknown): Record<string, string> {
  if (!autofill || typeof autofill !== 'object') return {}
  const output: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(autofill as Record<string, unknown>)) {
    const key = normalize(rawKey).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    const value = normalize(String(rawValue ?? ''))
    if (!key || !value) continue
    if (value.length > 240) continue
    output[key] = value
  }
  return output
}

export async function buildSearchIndexWithLLM(
  rawText: string,
  fields: FieldEntry[],
  fileName: string,
  config: LLMConfig
): Promise<SearchIndexFile> {
  const truncated = rawText.length > MAX_TEXT_CHARS
    ? `${rawText.slice(0, MAX_TEXT_CHARS)}\n[text truncated]`
    : rawText

  const userMessage = JSON.stringify(
    {
      fileName,
      text: truncated,
      fields: fields.map(field => ({
        label: field.label,
        value: field.value,
        sourceText: field.boundingContext,
      })),
    },
    null,
    2
  )

  const raw = await callLLM(SEARCH_INDEX_PROMPT, userMessage, config)
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  let items: SearchIndexItem[] = []
  try {
    const parsed = JSON.parse(cleaned) as {
      autofill?: unknown
      items?: Array<{
        fieldLabel?: string
        value?: string
        aliases?: unknown
        sourceText?: string
        confidence?: 'high' | 'medium' | 'low'
      }>
    }
    const seen = new Set<string>()

    for (const item of parsed.items ?? []) {
      const fieldLabel = normalize(item.fieldLabel ?? '')
      const value = normalize(item.value ?? '')
      const sourceText = normalize(item.sourceText ?? value)
      if (!fieldLabel || !value) continue
      if (value.length > 240) continue

      const key = `${fieldLabel.toLowerCase()}|${value.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)

      items.push({
        fieldLabel,
        value,
        aliases: normalizeAliases(item.aliases),
        sourceText,
        confidence: item.confidence ?? 'medium',
      })
    }

    const autofill = normalizeAutofill(parsed.autofill)
    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      items: items.slice(0, MAX_ITEMS),
      autofill,
    }
  } catch {
    items = []
  }

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    items: items.slice(0, MAX_ITEMS),
    autofill: {},
  }
}
