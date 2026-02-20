import { createWorker } from 'tesseract.js'
import type { Worker } from 'tesseract.js'
import { extractTextWithVision, canvasToBase64, fileToBase64 } from '../llm/vision'
import type { LLMConfig } from '../../types'
import type { PageEntry } from '../../types'

/** Tesseract confidence 0–100. Below this, Claude vision is used instead. */
export const OCR_CONFIDENCE_THRESHOLD = 60

function extensionAssetUrl(path: string): string {
  const runtime = (globalThis as { chrome?: { runtime?: { getURL?: (input: string) => string } } }).chrome?.runtime
  if (runtime?.getURL) return runtime.getURL(path)
  return new URL(path, window.location.origin).toString()
}

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

async function runVisionForImage(file: File, llmConfig?: LLMConfig): Promise<string | null> {
  if (!canUseVision(llmConfig)) return null
  const { base64, mediaType } = await fileToBase64(file)
  return normalizeOcrText(await extractTextWithVision(base64, mediaType, llmConfig))
}

async function runVisionForCanvas(canvas: HTMLCanvasElement, llmConfig?: LLMConfig): Promise<string | null> {
  if (!canUseVision(llmConfig)) return null
  const { base64, mediaType } = canvasToBase64(canvas)
  return normalizeOcrText(await extractTextWithVision(base64, mediaType, llmConfig))
}

async function makeWorker(onProgress?: (pct: number) => void): Promise<Worker> {
  const workerPath = extensionAssetUrl('tesseract/worker.min.js')
  const corePath = extensionAssetUrl('tesseract/tesseract-core-lstm.wasm.js')
  return createWorker('eng', 1, {
    workerPath,
    corePath,
    workerBlobURL: false,
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
  if (canUseVision(llmConfig)) {
    try {
      onProgress?.(20)
      const visionText = await runVisionForImage(file, llmConfig)
      onProgress?.(100)
      return {
        pages: [{ page: 1, rawText: visionText ?? '', fields: [] }],
        pageCount: 1,
      }
    } catch (err) {
      console.warn(`[FormBuddy] Vision-first OCR failed for ${file.name}, falling back to Tesseract: ${toErrorMessage(err)}`)
    }
  }

  let rawText = ''
  let confidence = 0
  let worker: Worker | null = null

  try {
    worker = await makeWorker(onProgress)
    const result = await worker.recognize(file)
    rawText = normalizeOcrText(result.data.text)
    confidence = result.data.confidence
  } catch (err) {
    console.warn(`[FormBuddy] Tesseract OCR failed for ${file.name}: ${toErrorMessage(err)}`)
    try {
      const visionText = await runVisionForImage(file, llmConfig)
      if (visionText !== null) {
        console.log(`[FormBuddy] Using Claude vision fallback after OCR failure for ${file.name}`)
        rawText = visionText
        confidence = 100
      } else {
        throw new Error(
          `OCR failed: ${toErrorMessage(err)}. Set an Anthropic API key to enable vision fallback.`
        )
      }
    } catch (visionErr) {
      throw new Error(`OCR failed and vision fallback failed: ${toErrorMessage(visionErr)}`)
    }
  } finally {
    if (worker) await worker.terminate()
  }

  if (confidence < OCR_CONFIDENCE_THRESHOLD && canUseVision(llmConfig)) {
    console.log(
      `[FormBuddy] Tesseract confidence ${confidence}% < ${OCR_CONFIDENCE_THRESHOLD}% — falling back to Claude vision for ${file.name}`
    )
    try {
      const visionText = await runVisionForImage(file, llmConfig)
      if (visionText) rawText = visionText
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

  if (canUseVision(llmConfig)) {
    for (let i = 0; i < canvases.length; i++) {
      const { pageNum, canvas } = canvases[i]
      try {
        const visionText = await runVisionForCanvas(canvas, llmConfig)
        results.set(pageNum, visionText ?? '')
      } catch (err) {
        throw new Error(`Vision OCR failed on page ${pageNum}: ${toErrorMessage(err)}`)
      }
      onProgress?.(Math.round(((i + 1) / total) * 100))
    }
    return results
  }

  let worker: Worker | null = null

  try {
    worker = await makeWorker()
  } catch (err) {
    console.warn(`[FormBuddy] Tesseract worker failed to start: ${toErrorMessage(err)}`)
    if (!canUseVision(llmConfig)) {
      throw new Error(
        `OCR worker failed: ${toErrorMessage(err)}. Set an Anthropic API key to enable vision fallback.`
      )
    }
    for (let i = 0; i < canvases.length; i++) {
      const { pageNum, canvas } = canvases[i]
      try {
        const visionText = await runVisionForCanvas(canvas, llmConfig)
        results.set(pageNum, visionText ?? '')
      } catch (visionErr) {
        throw new Error(
          `OCR worker failed and vision fallback failed on page ${pageNum}: ${toErrorMessage(visionErr)}`
        )
      }
      onProgress?.(Math.round(((i + 1) / total) * 100))
    }
    return results
  }

  for (let i = 0; i < canvases.length; i++) {
    const { pageNum, canvas } = canvases[i]
    let text = ''
    let confidence = 0
    try {
      const result = await worker.recognize(canvas)
      text = normalizeOcrText(result.data.text)
      confidence = result.data.confidence
    } catch (err) {
      console.warn(`[FormBuddy] OCR failed on page ${pageNum}: ${toErrorMessage(err)}`)
      if (!canUseVision(llmConfig)) {
        throw new Error(
          `OCR failed on page ${pageNum}: ${toErrorMessage(err)}. Set an Anthropic API key to enable vision fallback.`
        )
      }
      try {
        const visionText = await runVisionForCanvas(canvas, llmConfig)
        text = visionText ?? ''
        confidence = 100
      } catch (visionErr) {
        throw new Error(`OCR failed and vision fallback failed on page ${pageNum}: ${toErrorMessage(visionErr)}`)
      }
    }

    if (confidence < OCR_CONFIDENCE_THRESHOLD && canUseVision(llmConfig)) {
      console.log(
        `[FormBuddy] Page ${pageNum}: Tesseract confidence ${confidence}% < ${OCR_CONFIDENCE_THRESHOLD}% — using Claude vision`
      )
      try {
        const visionText = await runVisionForCanvas(canvas, llmConfig)
        if (visionText) text = visionText
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
