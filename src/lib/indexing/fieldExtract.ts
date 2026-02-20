import type { FieldEntry } from '../../types'

const FIELD_LINE_REGEX = /^([A-Za-z][A-Za-z0-9 ()/#._-]{1,80})\s*:\s*(.+)$/

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function extractFieldsFromRawText(rawText: string): FieldEntry[] {
  const fields: FieldEntry[] = []
  const seen = new Set<string>()
  const lines = rawText.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const match = FIELD_LINE_REGEX.exec(trimmed)
    if (!match) continue

    const label = normalizeSpaces(match[1])
    const value = normalizeSpaces(match[2])
    if (!label || !value) continue
    if (value.length > 220) continue

    const key = `${label.toLowerCase()}|${value.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    fields.push({
      label,
      value,
      confidence: 'high',
      boundingContext: trimmed,
    })
  }

  return fields
}
