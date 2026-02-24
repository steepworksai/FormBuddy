import { callLLM } from './index'
import type { LLMConfig, Suggestion } from '../../types'

type SuggestionPayload = Omit<Suggestion, 'id' | 'usedAt' | 'sessionId'>

const SYSTEM_PROMPT = `You are a form-filling assistant.
Given a field label, an optional format hint, and one or more source documents, return exactly one best value.
Return ONLY valid JSON with this shape:
{
  "value": "string or null",
  "sourceFile": "string",
  "sourceText": "string",
  "reason": "short plain-English reason",
  "confidence": "high | medium | low"
}
Rules:
- Read the cleanText of each document and extract the value that best matches the field label.
- If a "placeholder" is provided, format the output value to exactly match that pattern (e.g. placeholder "DD/MM/YYYY" means output "15/03/1985", not "1985-03-15").
- If no placeholder is given, output the value as found in the document.
- If nothing matches, return {"value": null, "sourceFile": "", "sourceText": "", "reason": "not found", "confidence": "low"}.
- Do not invent values not present in the source text.`

export async function generateSuggestionWithLLM(
  fieldId: string,
  fieldLabel: string,
  documents: Array<{ fileName: string; cleanText: string }>,
  config: LLMConfig,
  placeholder?: string
): Promise<SuggestionPayload | null> {
  const userPrompt = JSON.stringify(
    {
      fieldLabel,
      ...(placeholder ? { placeholder } : {}),
      documents: documents.map(d => ({
        fileName: d.fileName,
        cleanText: d.cleanText.slice(0, 4000),
      })),
    },
    null,
    2
  )

  const raw = await callLLM(SYSTEM_PROMPT, userPrompt, config)
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(cleaned) as {
      value: string | null
      sourceFile: string
      sourceText: string
      reason: string
      confidence: 'high' | 'medium' | 'low'
    }

    if (!parsed.value) return null

    return {
      fieldId,
      fieldLabel,
      value: parsed.value,
      sourceFile: parsed.sourceFile ?? documents[0]?.fileName ?? '',
      sourceText: parsed.sourceText ?? '',
      reason: parsed.reason ?? '',
      confidence: parsed.confidence ?? 'medium',
    }
  } catch {
    return null
  }
}
