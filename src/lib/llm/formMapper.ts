import { callLLM } from './index'
import { getFormAutofillMapPrompt } from './prompts'
import type { FormKVMapping, LLMConfig } from '../../types'

export interface FormFieldInput {
  fieldId: string
  fieldLabel: string
}

export interface FormMapDocumentInput {
  fileName: string
  autofill: Record<string, string>
  items: Array<{ fieldLabel: string; value: string; aliases: string[] }>
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export async function buildFormAutofillMapWithLLM(
  fields: FormFieldInput[],
  documents: FormMapDocumentInput[],
  config: LLMConfig
): Promise<FormKVMapping[]> {
  if (!fields.length || !documents.length) return []

  const payload = {
    fields: fields.map(field => ({ fieldId: field.fieldId, fieldLabel: field.fieldLabel })),
    documents,
  }

  const raw = await callLLM(getFormAutofillMapPrompt(), JSON.stringify(payload, null, 2), config)
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(cleaned) as {
      mappings?: Array<{
        fieldId?: string
        fieldLabel?: string
        value?: string
        sourceFile?: string
        reason?: string
        confidence?: 'high' | 'medium' | 'low'
      }>
    }

    const seen = new Set<string>()
    const result: FormKVMapping[] = []

    for (const item of parsed.mappings ?? []) {
      const fieldId = normalize(item.fieldId ?? '')
      const fieldLabel = normalize(item.fieldLabel ?? '')
      const value = normalize(item.value ?? '')
      if (!fieldId || !value) continue
      if (value.length > 260) continue
      if (seen.has(fieldId.toLowerCase())) continue
      seen.add(fieldId.toLowerCase())

      result.push({
        fieldId,
        fieldLabel: fieldLabel || fieldId,
        value,
        sourceFile: normalize(item.sourceFile ?? ''),
        reason: normalize(item.reason ?? ''),
        confidence: item.confidence ?? 'medium',
      })
    }

    return result
  } catch {
    return []
  }
}
