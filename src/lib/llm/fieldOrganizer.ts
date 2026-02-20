import { callLLM } from './index'
import { FIELD_ORGANIZER_PROMPT } from './prompts'
import type { FieldEntry, LLMConfig } from '../../types'

const MAX_TEXT_CHARS = 9000

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export async function organizeFieldsWithLLM(
  rawText: string,
  fileName: string,
  config: LLMConfig
): Promise<FieldEntry[]> {
  const truncated = rawText.length > MAX_TEXT_CHARS
    ? `${rawText.slice(0, MAX_TEXT_CHARS)}\n[text truncated]`
    : rawText

  const userMessage = `Document filename: ${fileName}\n\nText:\n${truncated}`
  const raw = await callLLM(FIELD_ORGANIZER_PROMPT, userMessage, config)
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(cleaned) as {
      fields?: Array<{ label?: string; value?: string; sourceText?: string }>
    }
    const seen = new Set<string>()
    const fields: FieldEntry[] = []

    for (const item of parsed.fields ?? []) {
      const label = normalize(item.label ?? '')
      const value = normalize(item.value ?? '')
      const sourceText = normalize(item.sourceText ?? value)
      if (!label || !value) continue
      if (value.length > 220) continue
      const key = `${label.toLowerCase()}|${value.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      fields.push({
        label,
        value,
        confidence: 'medium',
        boundingContext: sourceText,
      })
    }

    return fields
  } catch {
    return []
  }
}
