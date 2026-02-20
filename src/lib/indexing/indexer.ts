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
import { extractEntitiesWithLLM } from '../llm/extractor'
import { getTypeInfo } from '../config/supportedTypes'
import type { DocumentIndex, LLMConfig, PageEntry } from '../../types'

export type IndexResult =
  | { status: 'indexed'; entry: DocumentIndex }
  | { status: 'skipped'; fileName: string }
  | { status: 'unsupported'; fileName: string }
  | { status: 'too-large'; fileName: string; pageCount: number }

export type IndexPhase = 'parsing' | 'ocr' | 'extracting' | 'writing'

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
  if (existing && existing.checksum === checksum && !existing.needsReindex) {
    console.log(`[FormBuddy] Skipped (unchanged): ${file.name}`)
    return { status: 'skipped', fileName: file.name }
  }

  // ── Phase 1: Parse ────────────────────────────────────────
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
      throw err
    }

    // ── Phase 2 (conditional): OCR scanned pages ──────────
    const scannedPages = rawPages
      .filter(p => p.canvas !== undefined)
      .map(p => ({ pageNum: p.page, canvas: p.canvas! }))

    if (scannedPages.length > 0) {
      const allScanned = scannedPages.length === rawPages.length
      console.log(
        `[FormBuddy] ${allScanned ? 'Fully scanned' : 'Mixed'} PDF — OCR on ${scannedPages.length}/${rawPages.length} page(s): ${file.name}`
      )
      onPhase?.('ocr')

      const ocrResults = await ocrCanvases(scannedPages, onProgress, llmConfig)

      // Merge OCR text back into the page list
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
    // Plain text / note
    const text = await file.text()
    pages = [{ page: 1, rawText: text, fields: [] }]
    pageCount = 1
  }

  // ── Phase 3: LLM Entity Extraction ───────────────────────
  let entities: Record<string, string[]> = {}
  let summary = ''

  if (llmConfig?.apiKey) {
    onPhase?.('extracting')
    try {
      const fullText = pages.map(p => p.rawText).join('\n')
      const result = await extractEntitiesWithLLM(fullText, file.name, llmConfig)
      entities = result.entities
      summary = result.summary
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[FormBuddy] LLM extraction failed for ${file.name}:`, message)
      throw new Error(`LLM error: ${message}`)
    }
  } else {
    console.log(`[FormBuddy] No LLM config — skipping entity extraction for ${file.name}`)
  }

  // ── Phase 4: Write ────────────────────────────────────────
  onPhase?.('writing')

  const id = existing?.id ?? crypto.randomUUID()
  const indexEntry: DocumentIndex = {
    id,
    fileName: file.name,
    type: ext === 'pdf' ? 'pdf' : ext === 'txt' ? 'text' : 'image',
    indexedAt: new Date().toISOString(),
    language: 'en',
    pageCount: pageCount!,
    pages,
    entities,
    summary,
    usedFields: existing
      ? ((await readIndexEntry(dirHandle, `${id}.json`))?.usedFields ?? [])
      : [],
  }

  await writeIndexEntry(dirHandle, `${id}.json`, indexEntry)

  const updatedManifest = {
    ...manifest,
    lastUpdated: new Date().toISOString(),
    documents: [
      ...manifest.documents.filter(d => d.fileName !== file.name),
      buildManifestEntry(indexEntry, checksum, file.size),
    ],
  }
  await writeManifest(dirHandle, updatedManifest)

  console.log(`[FormBuddy] Indexed: ${file.name} → ${id}.json`)
  return { status: 'indexed', entry: indexEntry }
}
