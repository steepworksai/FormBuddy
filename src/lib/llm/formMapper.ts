import { callLLM } from './index'
import { getManualFieldExtractionPrompt } from './prompts'
import type { FormKVMapping, LLMConfig } from '../../types'

export interface FormFieldInput {
  fieldId: string
  fieldLabel: string
}

export interface FormMapDocumentInput {
  fileName: string
  autofill: Record<string, string>
  items: Array<{ fieldLabel: string; value: string; aliases: string[] }>
  referenceJson?: unknown
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeKey(value: string): string {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}

interface FormMapperOptions {
  rawFieldsInput?: string
}

function parseKeyValueMappings(
  cleaned: string,
  fields: FormFieldInput[],
  documents: FormMapDocumentInput[]
): FormKVMapping[] {
  const lines = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const byFieldLabel = new Map<string, FormFieldInput>()
  const byFieldId = new Map<string, FormFieldInput>()
  for (const field of fields) {
    byFieldLabel.set(normalizeKey(field.fieldLabel), field)
    byFieldId.set(normalizeKey(field.fieldId), field)
  }

  const seen = new Set<string>()
  const firstSource = documents[0]?.fileName ?? 'Selected docs'
  const result: FormKVMapping[] = []

  for (const line of lines) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const rawLabel = normalize(line.slice(0, separator))
    const rawValue = normalize(line.slice(separator + 1))
    if (!rawLabel || !rawValue) continue
    if (/^not found$/i.test(rawValue)) continue

    const labelKey = normalizeKey(rawLabel)
    const matchedField = byFieldLabel.get(labelKey) ?? byFieldId.get(labelKey)
    const fieldId = matchedField?.fieldId ?? rawLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    const fieldLabel = matchedField?.fieldLabel ?? rawLabel
    const dedupeKey = normalizeKey(fieldId)
    if (!dedupeKey || seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    result.push({
      fieldId,
      fieldLabel,
      value: rawValue,
      sourceFile: firstSource,
      reason: 'Mapped from manual field extraction prompt',
      confidence: 'medium',
    })
  }

  return result
}

export async function buildFormAutofillMapWithLLM(
  fields: FormFieldInput[],
  documents: FormMapDocumentInput[],
  config: LLMConfig,
  options?: FormMapperOptions
): Promise<FormKVMapping[]> {
  if (!fields.length || !documents.length) return []
  const payload = {
    reference_json: documents.map(doc => ({
      fileName: doc.fileName,
      document: doc.referenceJson ?? doc,
    })),
    form_fields: options?.rawFieldsInput?.trim() || fields.map(field => field.fieldLabel).join('\n'),
  }
  const systemPrompt = getManualFieldExtractionPrompt()
  const userMessage = JSON.stringify(payload, null, 2)

  const raw = await callLLM(systemPrompt, userMessage, config)
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  return parseKeyValueMappings(cleaned, fields, documents)
}
