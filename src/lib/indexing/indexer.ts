import { computeChecksum } from './checksum'
import {
  readManifest,
  writeManifest,
  readIndexEntry,
  writeIndexEntry,
  buildManifestEntry,
} from './manifest'
import { extractTextFromPDF, PDFTooLargeError } from '../parser/pdf'
import { extractTextFromImage, ocrCanvases } from '../parser/ocr'
import { cleanTextWithLLM } from '../llm/extractor'
import { getTypeInfo } from '../config/supportedTypes'
import type { DocumentIndex, LLMConfig, PageEntry } from '../../types'

export type IndexResult =
  | { status: 'indexed'; entry: DocumentIndex }
  | { status: 'skipped'; fileName: string }
  | { status: 'unsupported'; fileName: string }
  | { status: 'too-large'; fileName: string; pageCount: number }

export type IndexPhase = 'parsing' | 'ocr' | 'extracting' | 'writing'

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    const maybeMessage = (err as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) return maybeMessage
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export async function indexDocument(
  file: File,
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (pct: number) => void,
  onPhase?: (phase: IndexPhase) => void,
  llmConfig?: LLMConfig
): Promise<IndexResult> {
  const typeInfo = getTypeInfo(file.name)
  if (!typeInfo) return { status: 'unsupported', fileName: file.name }

  const checksum = await computeChecksum(file)
  const manifest = await readManifest(dirHandle)

  const existing = manifest.documents.find(d => d.fileName === file.name)
  const previousEntry = existing ? await readIndexEntry(dirHandle, `${existing.id}.json`) : null
  const llmAlreadyPrepared =
    existing?.llmPrepared === true ||
    !!(previousEntry && previousEntry.cleanText && previousEntry.cleanText.trim().length > 0)

  if (existing && existing.checksum === checksum && !existing.needsReindex) {
    const indexExists = await readIndexEntry(dirHandle, `${existing.id}.json`)
    if (indexExists) {
      return { status: 'skipped', fileName: file.name }
    }
  }

  // ── Phase 1: Parse ────────────────────────────────────────
  // PDFs: text extracted via pdfjs-dist (+ LLM OCR for scanned pages)
  // Images: text extracted via LLM vision
  // Both produce pages[].rawText before Phase 2.
  onPhase?.('parsing')

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  let pages: PageEntry[]
  let pageCount: number

  if (ext === 'pdf') {
    let rawPages: Awaited<ReturnType<typeof extractTextFromPDF>>['pages']

    try {
      const result = await extractTextFromPDF(file)
      rawPages = result.pages
      pageCount = result.pageCount
    } catch (err) {
      if (err instanceof PDFTooLargeError) {
        console.warn(`[FormBuddy] PDF too large: ${file.name} (${err.pageCount} pages)`)
        return { status: 'too-large', fileName: file.name, pageCount: err.pageCount }
      }
      console.warn(`[FormBuddy] PDF parse failed for ${file.name}:`, errorMessage(err))
      rawPages = []
      pageCount = 0
    }

    const scannedPages = rawPages
      .filter(p => p.canvas !== undefined)
      .map(p => ({ pageNum: p.page, canvas: p.canvas! }))

    if (scannedPages.length > 0) {
      onPhase?.('ocr')
      let ocrResults = new Map<number, string>()
      try {
        ocrResults = await ocrCanvases(scannedPages, onProgress, llmConfig)
      } catch (err) {
        console.warn(`[FormBuddy] OCR failed for ${file.name}:`, err instanceof Error ? err.message : String(err))
      }
      pages = rawPages.map(p =>
        p.canvas
          ? { page: p.page, rawText: ocrResults.get(p.page) ?? '', fields: [] }
          : { page: p.page, rawText: p.rawText, fields: [] }
      )
    } else {
      pages = rawPages.map(p => ({ page: p.page, rawText: p.rawText, fields: [] }))
    }

  } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    onPhase?.('ocr')
    const result = await extractTextFromImage(file, onProgress, llmConfig)
    pages = result.pages
    pageCount = result.pageCount

  } else {
    const text = await file.text()
    pages = [{ page: 1, rawText: text, fields: [] }]
    pageCount = 1
  }

  // ── Phase 2: LLM Text Cleanup ─────────────────────────────
  // Same step for both PDFs and images.
  // Takes raw text from Phase 1 and produces a clean, de-noised version.
  const rawText = pages.map(p => p.rawText).join('\n')
  let cleanText = rawText

  let llmPreparedThisRun = false
  if (llmConfig?.apiKey && !llmAlreadyPrepared) {
    onPhase?.('extracting')
    try {
      cleanText = await cleanTextWithLLM(rawText, file.name, llmConfig)
      llmPreparedThisRun = true
    } catch (err) {
      console.warn(`[FormBuddy] Text cleanup failed for ${file.name}:`, errorMessage(err))
    }
  } else if (llmAlreadyPrepared && previousEntry) {
    cleanText = previousEntry.cleanText ?? rawText
  }

  // ── Phase 3: Write ────────────────────────────────────────
  // Once cleanText is stored, raw text is no longer needed — drop it to save space.
  // If cleanup hasn't run yet (no API key), raw text is kept as the only text available.
  const cleanupComplete = llmPreparedThisRun || llmAlreadyPrepared

  onPhase?.('writing')

  const id = existing?.id ?? crypto.randomUUID()
  const indexEntry: DocumentIndex = {
    id,
    fileName: file.name,
    type: file.name.toLowerCase().startsWith('screenshot-')
      ? 'screenshot'
      : ext === 'pdf'
        ? 'pdf'
        : ext === 'txt'
          ? 'text'
          : 'image',
    indexedAt: new Date().toISOString(),
    language: 'en',
    pageCount: pageCount ?? 0,
    pages: cleanupComplete ? pages.map(p => ({ ...p, rawText: '' })) : pages,
    rawText: cleanupComplete ? undefined : rawText,
    cleanText,
    usedFields: existing
      ? ((await readIndexEntry(dirHandle, `${id}.json`))?.usedFields ?? [])
      : [],
  }

  try {
    await writeIndexEntry(dirHandle, `${id}.json`, indexEntry)
  } catch (err) {
    console.error(`[FormBuddy] writeIndexEntry FAILED for ${file.name}:`, errorMessage(err))
    throw err
  }

  const updatedManifest = {
    ...manifest,
    lastUpdated: new Date().toISOString(),
    documents: [
      ...manifest.documents.filter(d => d.fileName !== file.name),
      buildManifestEntry(indexEntry, checksum, file.size, llmAlreadyPrepared || llmPreparedThisRun),
    ],
  }
  try {
    await writeManifest(dirHandle, updatedManifest)
  } catch (err) {
    console.error(`[FormBuddy] writeManifest FAILED for ${file.name}:`, errorMessage(err))
    throw err
  }

  return { status: 'indexed', entry: indexEntry }
}
