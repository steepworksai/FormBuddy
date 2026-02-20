import { extractTextWithVision, canvasToBase64, fileToBase64 } from '../llm/vision'
import type { LLMConfig } from '../../types'
import type { PageEntry } from '../../types'

function normalizeOcrText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function canUseVision(config?: LLMConfig): config is LLMConfig {
  return !!config?.apiKey && config.provider === 'anthropic'
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * OCR a standalone image file (PNG, JPG, WEBP) using Claude vision.
 * Requires an Anthropic API key.
 */
export async function extractTextFromImage(
  file: File,
  onProgress?: (pct: number) => void,
  llmConfig?: LLMConfig
): Promise<{ pages: PageEntry[]; pageCount: number }> {
  if (!canUseVision(llmConfig)) {
    throw new Error(
      `An Anthropic API key is required to process image files. ` +
      `Open settings and add your key to index "${file.name}".`
    )
  }
  try {
    onProgress?.(20)
    const { base64, mediaType } = await fileToBase64(file)
    const rawText = normalizeOcrText(await extractTextWithVision(base64, mediaType, llmConfig))
    onProgress?.(100)
    return {
      pages: [{ page: 1, rawText, fields: [] }],
      pageCount: 1,
    }
  } catch (err) {
    throw new Error(`Vision OCR failed for ${file.name}: ${toErrorMessage(err)}`)
  }
}

/**
 * OCR multiple canvases (scanned PDF pages) using Claude vision.
 * Requires an Anthropic API key.
 */
export async function ocrCanvases(
  canvases: Array<{ pageNum: number; canvas: HTMLCanvasElement }>,
  onProgress?: (pct: number) => void,
  llmConfig?: LLMConfig
): Promise<Map<number, string>> {
  if (!canUseVision(llmConfig)) {
    throw new Error(
      'An Anthropic API key is required to process scanned PDF pages. ' +
      'Open settings and add your key.'
    )
  }

  const total = canvases.length
  const results = new Map<number, string>()

  for (let i = 0; i < canvases.length; i++) {
    const { pageNum, canvas } = canvases[i]
    try {
      const { base64, mediaType } = canvasToBase64(canvas)
      const text = normalizeOcrText(await extractTextWithVision(base64, mediaType, llmConfig))
      results.set(pageNum, text)
    } catch (err) {
      throw new Error(`Vision OCR failed on page ${pageNum}: ${toErrorMessage(err)}`)
    }
    onProgress?.(Math.round(((i + 1) / total) * 100))
  }

  return results
}
