import { callLLM } from './index'
import type { LLMConfig } from '../../types'

// Cap raw text sent to LLM to keep token usage reasonable
const MAX_TEXT_CHARS = 8000

const SYSTEM_PROMPT = `You are a document text cleaner. You receive raw text extracted from a scanned image or PDF via OCR. The text may contain:
- Repeated or duplicate lines (e.g. watermarks printed multiple times)
- Layout noise such as stray characters or broken words
- Garbled characters from poor scan quality
- Irrelevant repeated headers or footers

Your task:
- Remove duplicate and noise lines
- Fix obvious OCR errors only when the correction is certain
- Preserve all labels, values, numbers, dates, codes, and identifiers exactly as they appear
- Keep the logical structure and reading order of the document
- Do not categorize, reformat, summarize, or restructure the content

Return only the cleaned text — no commentary, no markdown, no JSON.`

export async function cleanTextWithLLM(
  rawText: string,
  fileName: string,
  config: LLMConfig
): Promise<string> {
  const truncated = rawText.length > MAX_TEXT_CHARS
    ? rawText.slice(0, MAX_TEXT_CHARS) + '\n[text truncated]'
    : rawText

  const userMessage = `Document: ${fileName}\n\nRaw text:\n${truncated}`

  const result = await callLLM(SYSTEM_PROMPT, userMessage, config)
  return result.trim() || rawText
}
