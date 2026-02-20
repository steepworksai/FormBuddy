import { callLLM } from './index'
import type { LLMConfig } from '../../types'

// Cap raw text sent to LLM to keep token usage reasonable
const MAX_TEXT_CHARS = 8000

const SYSTEM_PROMPT = `You are a personal document data extractor. Given raw text from a document, extract structured entities and return ONLY valid JSON — no markdown, no explanation.

Return this exact JSON shape:
{
  "entities": {
    "numbers":     [],  // account numbers, reference numbers, order numbers
    "dates":       [],  // all dates (ISO format preferred)
    "names":       [],  // full person names
    "addresses":   [],  // full street/mailing addresses
    "employers":   [],  // company or employer names
    "currencies":  [],  // monetary amounts, e.g. "$74,250.00"
    "identifiers": []   // SSN, EIN, passport numbers, license numbers, policy IDs, tax IDs
  },
  "summary": "One or two plain-English sentences describing what this document is."
}

Rules:
- Arrays may be empty if no values are found.
- Include only clearly identifiable values — do not guess.
- De-duplicate values within each array.
- If the document is not in English, still return the JSON in English.`

interface ExtractionResult {
  entities: Record<string, string[]>
  summary: string
}

const EMPTY_RESULT: ExtractionResult = {
  entities: {
    numbers: [],
    dates: [],
    names: [],
    addresses: [],
    employers: [],
    currencies: [],
    identifiers: [],
  },
  summary: '',
}

export async function extractEntitiesWithLLM(
  rawText: string,
  fileName: string,
  config: LLMConfig
): Promise<ExtractionResult> {
  const truncated = rawText.length > MAX_TEXT_CHARS
    ? rawText.slice(0, MAX_TEXT_CHARS) + '\n[text truncated]'
    : rawText

  const userMessage = `Document filename: ${fileName}\n\nText:\n${truncated}`

  const raw = await callLLM(SYSTEM_PROMPT, userMessage, config)

  // Strip markdown code fences if the LLM wrapped the JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(cleaned) as ExtractionResult
    return {
      entities: { ...EMPTY_RESULT.entities, ...parsed.entities },
      summary: parsed.summary ?? '',
    }
  } catch {
    console.warn('[FormBuddy] LLM returned unparseable JSON:', raw)
    return EMPTY_RESULT
  }
}
