import { callLLM } from './index'
import type { LLMConfig, Suggestion } from '../../types'
import type { QueryCandidate } from '../indexing/query'

type SuggestionPayload = Omit<Suggestion, 'id' | 'usedAt' | 'sessionId'>

const SYSTEM_PROMPT = `You are a form-filling assistant.
Given a field label and a few candidate snippets, return exactly one best suggestion.
Return ONLY valid JSON with this shape:
{
  "value": "string or null",
  "sourceFile": "string",
  "sourcePage": 1,
  "sourceText": "string",
  "reason": "short plain-English reason",
  "confidence": "high | medium | low"
}
Rules:
- Use only the provided snippets. Do not invent values.
- If nothing matches, return {"value": null, ...} with empty strings.`

function emptySuggestion(fieldId: string, fieldLabel: string): SuggestionPayload {
  return {
    fieldId,
    fieldLabel,
    value: '',
    sourceFile: '',
    sourceText: '',
    reason: '',
    confidence: 'low',
  }
}

export async function generateSuggestionWithLLM(
  fieldId: string,
  fieldLabel: string,
  candidates: QueryCandidate[],
  config: LLMConfig
): Promise<SuggestionPayload | null> {
  const userPrompt = JSON.stringify(
    {
      fieldLabel,
      candidates: candidates.map(c => ({
        fileName: c.fileName,
        sourcePage: c.sourcePage ?? null,
        sourceText: c.sourceText,
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
      sourcePage?: number
      sourceText: string
      reason: string
      confidence: 'high' | 'medium' | 'low'
    }

    if (!parsed.value) return null

    return {
      ...emptySuggestion(fieldId, fieldLabel),
      value: parsed.value,
      sourceFile: parsed.sourceFile,
      sourcePage: parsed.sourcePage,
      sourceText: parsed.sourceText,
      reason: parsed.reason,
      confidence: parsed.confidence,
    }
  } catch {
    return null
  }
}
