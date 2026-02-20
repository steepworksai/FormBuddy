import { computeChecksum } from './checksum'
import {
  readManifest,
  writeManifest,
  readIndexEntry,
  writeIndexEntry,
  readSearchIndexEntry,
  writeSearchIndexEntry,
  buildManifestEntry,
} from './manifest'
import { extractTextFromPDF, PDFTooLargeError } from '../parser/pdf'
import { extractTextFromImage, ocrCanvases } from '../parser/ocr'
import { extractEntitiesWithLLM } from '../llm/extractor'
import { organizeFieldsWithLLM } from '../llm/fieldOrganizer'
import { buildSearchIndexWithLLM } from '../llm/searchIndex'
import { extractFieldsFromRawText } from './fieldExtract'
import { getTypeInfo } from '../config/supportedTypes'
import type { DocumentIndex, FieldEntry, LLMConfig, PageEntry, SearchIndexFile } from '../../types'

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

function dedupeFields(fields: FieldEntry[]): FieldEntry[] {
  const seen = new Set<string>()
  const result: FieldEntry[] = []
  for (const field of fields) {
    const key = `${field.label.toLowerCase()}|${field.value.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(field)
  }
  return result
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
  const previousSearchIndex = existing?.searchIndexFile
    ? await readSearchIndexEntry(dirHandle, existing.searchIndexFile)
    : null
  const llmAlreadyPrepared =
    existing?.llmPrepared === true ||
    !!(
      previousEntry &&
      (
        (previousEntry.summary && previousEntry.summary.trim().length > 0) ||
        Object.values(previousEntry.entities ?? {}).some(values => values.length > 0)
      )
    )
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
      throw new Error(`PDF parse error: ${errorMessage(err)}`)
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
  pages = pages.map(page => ({
    ...page,
    fields: page.fields.length > 0 ? page.fields : extractFieldsFromRawText(page.rawText),
  }))

  if (llmConfig?.apiKey && !llmAlreadyPrepared) {
    const extractedCount = pages.reduce((acc, page) => acc + page.fields.length, 0)
    if (extractedCount < 3) {
      try {
        const fullText = pages.map(p => p.rawText).join('\n')
        const organizedFields = await organizeFieldsWithLLM(fullText, file.name, llmConfig)
        if (organizedFields.length > 0) {
          const firstPage = pages[0] ?? { page: 1, rawText: '', fields: [] }
          firstPage.fields = dedupeFields([...firstPage.fields, ...organizedFields])
          pages = [firstPage, ...pages.slice(1)]
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[FormBuddy] Field organizer failed for ${file.name}:`, message)
      }
    }
  }

  let entities: Record<string, string[]> = {}
  let summary = ''
  let searchIndex: SearchIndexFile | undefined = previousSearchIndex ?? undefined

  let llmPreparedThisRun = false
  if (llmConfig?.apiKey && !llmAlreadyPrepared) {
    onPhase?.('extracting')
    try {
      const fullText = pages.map(p => p.rawText).join('\n')
      const result = await extractEntitiesWithLLM(fullText, file.name, llmConfig)
      entities = result.entities
      summary = result.summary
      llmPreparedThisRun = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[FormBuddy] LLM extraction failed for ${file.name}:`, message)
      throw new Error(`LLM error: ${message}`)
    }
  } else {
    if (llmAlreadyPrepared && previousEntry) {
      entities = previousEntry.entities
      summary = previousEntry.summary
      console.log(`[FormBuddy] LLM already prepared — skipping LLM reindex for ${file.name}`)
    } else {
      console.log(`[FormBuddy] No LLM config — skipping entity extraction for ${file.name}`)
    }
  }

  if (llmConfig?.apiKey) {
    try {
      const allFields = pages.flatMap(page => page.fields)
      const fullText = pages.map(p => p.rawText).join('\n')
      const generatedSearchIndex = await buildSearchIndexWithLLM(fullText, allFields, file.name, llmConfig)
      if (generatedSearchIndex.items.length > 0 || Object.keys(generatedSearchIndex.autofill ?? {}).length > 0) {
        searchIndex = generatedSearchIndex
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[FormBuddy] Search index generation failed for ${file.name}:`, message)
    }
  }

  // ── Phase 4: Write ────────────────────────────────────────
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
    pageCount: pageCount!,
    pages,
    entities,
    summary,
    usedFields: existing
      ? ((await readIndexEntry(dirHandle, `${id}.json`))?.usedFields ?? [])
      : [],
  }

  await writeIndexEntry(dirHandle, `${id}.json`, indexEntry)
  const searchIndexFile = `${id}.search.index.json`
  if (searchIndex) {
    await writeSearchIndexEntry(dirHandle, searchIndexFile, searchIndex)
  }

  const updatedManifest = {
    ...manifest,
    lastUpdated: new Date().toISOString(),
    documents: [
      ...manifest.documents.filter(d => d.fileName !== file.name),
      buildManifestEntry(
        indexEntry,
        checksum,
        file.size,
        llmAlreadyPrepared || llmPreparedThisRun,
        searchIndex ? searchIndexFile : undefined
      ),
    ],
  }
  await writeManifest(dirHandle, updatedManifest)

  console.log(`[FormBuddy] Indexed: ${file.name} → ${id}.json`)
  return { status: 'indexed', entry: indexEntry }
}
