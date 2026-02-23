import { callLLM } from './index'
import type { LLMConfig, Suggestion } from '../../types'

type SuggestionPayload = Omit<Suggestion, 'id' | 'usedAt' | 'sessionId'>

const SYSTEM_PROMPT = `You are a form-filling assistant.
Given a field label and one or more source documents, return exactly one best value.
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
- If nothing matches, return {"value": null, "sourceFile": "", "sourceText": "", "reason": "not found", "confidence": "low"}.
- Do not invent values not present in the source text.`

export async function generateSuggestionWithLLM(
  fieldId: string,
  fieldLabel: string,
  documents: Array<{ fileName: string; cleanText: string }>,
  config: LLMConfig
): Promise<SuggestionPayload | null> {
  const userPrompt = JSON.stringify(
    {
      fieldLabel,
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
