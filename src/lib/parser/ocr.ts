import { createWorker } from 'tesseract.js'
import type { Worker } from 'tesseract.js'
import { extractTextWithVision, canvasToBase64, fileToBase64 } from '../llm/vision'
import type { LLMConfig } from '../../types'
import type { PageEntry } from '../../types'

/** Tesseract confidence 0–100. Below this, Claude vision is used instead. */
export const OCR_CONFIDENCE_THRESHOLD = 60

async function makeWorker(onProgress?: (pct: number) => void): Promise<Worker> {
  return createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onProgress?.(Math.round(m.progress * 100))
      }
    },
  })
}

/**
 * OCR a standalone image file (PNG, JPG, WEBP).
 * Falls back to Claude vision if Tesseract confidence is below the threshold.
 */
export async function extractTextFromImage(
  file: File,
  onProgress?: (pct: number) => void,
  llmConfig?: LLMConfig
): Promise<{ pages: PageEntry[]; pageCount: number }> {
  const worker = await makeWorker(onProgress)
  const { data } = await worker.recognize(file)
  await worker.terminate()

  let rawText = data.text.replace(/\s+/g, ' ').trim()
  const confidence = data.confidence

  if (confidence < OCR_CONFIDENCE_THRESHOLD && llmConfig?.provider === 'anthropic') {
    console.log(
      `[FormBuddy] Tesseract confidence ${confidence}% < ${OCR_CONFIDENCE_THRESHOLD}% — falling back to Claude vision for ${file.name}`
    )
    try {
      const { base64, mediaType } = await fileToBase64(file)
      rawText = await extractTextWithVision(base64, mediaType, llmConfig)
    } catch (err) {
      console.warn('[FormBuddy] Claude vision fallback failed, keeping Tesseract result:', err)
    }
  } else if (confidence < OCR_CONFIDENCE_THRESHOLD) {
    console.warn(
      `[FormBuddy] Tesseract confidence ${confidence}% is low for ${file.name}. ` +
      'Set an Anthropic API key to enable Claude vision fallback.'
    )
  }

  return {
    pages: [{ page: 1, rawText, fields: [] }],
    pageCount: 1,
  }
}

/**
 * OCR multiple canvases (scanned PDF pages) with a single shared worker.
 * Falls back to Claude vision per-page when confidence is below the threshold.
 * Reports overall progress 0–100% across all pages.
 */
export async function ocrCanvases(
  canvases: Array<{ pageNum: number; canvas: HTMLCanvasElement }>,
  onProgress?: (pct: number) => void,
  llmConfig?: LLMConfig
): Promise<Map<number, string>> {
  const total = canvases.length
  const results = new Map<number, string>()
  const worker = await makeWorker()

  for (let i = 0; i < canvases.length; i++) {
    const { pageNum, canvas } = canvases[i]
    const { data } = await worker.recognize(canvas)
    let text = data.text.replace(/\s+/g, ' ').trim()
    const confidence = data.confidence

    if (confidence < OCR_CONFIDENCE_THRESHOLD && llmConfig?.provider === 'anthropic') {
      console.log(
        `[FormBuddy] Page ${pageNum}: Tesseract confidence ${confidence}% < ${OCR_CONFIDENCE_THRESHOLD}% — using Claude vision`
      )
      try {
        const { base64, mediaType } = canvasToBase64(canvas)
        text = await extractTextWithVision(base64, mediaType, llmConfig)
      } catch (err) {
        console.warn(`[FormBuddy] Claude vision fallback failed for page ${pageNum}, keeping Tesseract result:`, err)
      }
    } else if (confidence < OCR_CONFIDENCE_THRESHOLD) {
      console.warn(
        `[FormBuddy] Page ${pageNum}: Tesseract confidence ${confidence}% is low. ` +
        'Set an Anthropic API key to enable Claude vision fallback.'
      )
    }

    results.set(pageNum, text)
    onProgress?.(Math.round(((i + 1) / total) * 100))
  }

  await worker.terminate()
  return results
}
