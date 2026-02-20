import { useEffect, useMemo, useRef, useState } from 'react'
import { requestFolderAccess, listFiles } from '../lib/folder/access'
import { writeFileToFolder } from '../lib/folder/access'
import { indexDocument } from '../lib/indexing/indexer'
import {
  readFormKVCacheEntry,
  readIndexEntry,
  readManifest,
  readSearchIndexEntry,
  writeFormKVCacheEntry,
  writeManifest,
} from '../lib/indexing/manifest'
import { getTypeInfo } from '../lib/config/supportedTypes'
import { isSupported } from '../lib/config/supportedTypes'
import { MAX_PDF_PAGES } from '../lib/parser/pdf'
import type { DocumentIndex, FormKVMapping, LLMConfig } from '../types'
import type { IndexPhase } from '../lib/indexing/indexer'

interface FileEntry {
  name: string
  size: number
  status: 'pending' | 'indexing' | 'indexed' | 'skipped' | 'too-large' | 'error'
  phase?: IndexPhase
  ocrProgress?: number
  error?: string
}

interface LookupResult {
  id: string
  label: string
  value: string
  sourceFile: string
  sourcePage?: number
  sourceText: string
}

interface ManualFieldResult {
  id: string
  fieldLabel: string
  value: string
  sourceFile: string
  sourcePage?: number
}

function getErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    const maybeMessage = (err as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) return maybeMessage
  }
  try {
    const serialized = JSON.stringify(err)
    return serialized === undefined ? fallback : serialized
  } catch {
    return fallback
  }
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder()
  const data = enc.encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_ICON: Record<FileEntry['status'], string> = {
  pending:    '⏳',
  indexing:   '⚙️',
  indexed:    '✅',
  skipped:    '⏭️',
  'too-large':'🚫',
  error:      '❌',
}

const PHASE_LABEL: Record<IndexPhase, string> = {
  parsing:    'Parsing…',
  ocr:        'OCR…',
  extracting: 'AI…',
  writing:    'Saving…',
}

async function loadLLMConfig(): Promise<LLMConfig | undefined> {
  return new Promise(resolve => {
    chrome.storage.local.get('llmConfig', r => resolve(r.llmConfig as LLMConfig | undefined))
  })
}

function isBrowserInternalUrl(url: string | undefined): boolean {
  if (!url) return false
  return /^(chrome|chrome-extension|edge|about):/i.test(url)
}

async function captureVisibleTabPng(): Promise<Blob> {
  const tabsInWindow = await chrome.tabs.query({ currentWindow: true })
  const activeTab = tabsInWindow.find(tab => tab.active)
  if (!activeTab || activeTab.windowId === undefined) {
    throw new Error('No active tab found. Open the target page and try again.')
  }

  // If the currently active tab is an internal page, switch to a capture-eligible tab.
  let targetTab = activeTab
  if (isBrowserInternalUrl(targetTab.url)) {
    const fallback = tabsInWindow.find(
      tab => tab.id && !isBrowserInternalUrl(tab.url) && tab.windowId === activeTab.windowId
    )
    if (!fallback?.id) {
      throw new Error('Screenshots are blocked on browser internal pages. Open a website form and try again.')
    }
    await chrome.tabs.update(fallback.id, { active: true })
    targetTab = fallback
  }

  let dataUrl = ''
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, { format: 'png' })
  } catch {
    // Fallback for environments where window-scoped capture fails.
    dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' })
  }

  const response = await fetch(dataUrl)
  return await response.blob()
}

type IndexOverrideResult = {
  status: 'indexed' | 'skipped' | 'too-large'
  pageCount?: number
}

type IndexOverride = (
  file: File,
  llmConfig: LLMConfig | undefined
) => Promise<IndexOverrideResult> | IndexOverrideResult

function getIndexOverride(): IndexOverride | undefined {
  return (window as unknown as { __FORMBUDDY_INDEX_OVERRIDE?: IndexOverride }).__FORMBUDDY_INDEX_OVERRIDE
}

async function indexWithOptionalOverride(
  file: File,
  dirHandle: FileSystemDirectoryHandle,
  onOcrProgress: (pct: number) => void,
  onPhase: (phase: IndexPhase) => void,
  llmConfig: LLMConfig | undefined
) {
  const override = getIndexOverride()
  if (override) return await override(file, llmConfig)
  return await indexDocument(file, dirHandle, onOcrProgress, onPhase, llmConfig)
}

/** Mark only never-LLM-processed documents for reindex. */
async function markAllForReindex(dirHandle: FileSystemDirectoryHandle): Promise<void> {
  const manifest = await readManifest(dirHandle)
  await writeManifest(dirHandle, {
    ...manifest,
    documents: manifest.documents.map(d => ({
      ...d,
      // Refresh should not rebuild already LLM-prepared documents.
      // Only documents that never had LLM prep are marked for reindex.
      needsReindex: d.llmPrepared ? false : true,
    })),
  })
}

export default function SidePanel() {
  const [files, setFiles]         = useState<FileEntry[]>([])
  const [folderName, setFolderName] = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [busy, setBusy]           = useState(false)
  const [noLLM, setNoLLM]         = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const [indexedDocs, setIndexedDocs] = useState<DocumentIndex[]>([])
  const [lookupQuery, setLookupQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyLog, setCopyLog] = useState<Array<{ label: string; value: string; copiedAt: string }>>([])
  const [navInfo, setNavInfo] = useState<{ pageIndex: number; domain: string; url: string } | null>(null)
  const [screenshotStatus, setScreenshotStatus] = useState<'idle' | 'indexing' | 'ready' | 'error'>('idle')
  const [quickNote, setQuickNote] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [fieldsToFetch, setFieldsToFetch] = useState('')
  const [manualFetchBusy, setManualFetchBusy] = useState(false)
  const [manualFieldResults, setManualFieldResults] = useState<ManualFieldResult[]>([])
  const [manualCopiedId, setManualCopiedId] = useState<string | null>(null)

  // Persist between renders without triggering re-renders
  const dirHandleRef       = useRef<FileSystemDirectoryHandle | null>(null)
  const rawFilesRef        = useRef<File[]>([])
  const selectedFilesRef   = useRef<Set<string>>(new Set())

  useEffect(() => {
    const testHooks = window as unknown as {
      __FORMBUDDY_TEST_DROP_FILES?: (files: File[]) => Promise<void>
    }
    testHooks.__FORMBUDDY_TEST_DROP_FILES = async (filesToDrop: File[]) => {
      await processDroppedFiles(filesToDrop)
    }
    return () => {
      delete testHooks.__FORMBUDDY_TEST_DROP_FILES
    }
  }, [])

  useEffect(() => {
    const onMessage = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      const msg = message as {
        type?: string
        payload?: {
          pageIndex?: number
          domain?: string
          url?: string
          content?: string
          message?: string
          text?: string
          signature?: string
          mappings?: FormKVMapping[]
          status?: 'idle' | 'running' | 'ready' | 'error'
          count?: number
          cached?: boolean
          generatedAt?: string
          reason?: string
          stage?: string
        }
      }

      if (msg.type === 'PAGE_NAVIGATED' && msg.payload?.url) {
        setNavInfo({
          pageIndex: msg.payload.pageIndex ?? 1,
          domain: msg.payload.domain ?? '',
          url: msg.payload.url,
        })
        return
      }

      if (msg.type === 'CAPTURE_SCREENSHOT_REQUEST') {
        void handleCaptureScreenshot()
        return
      }

      if (msg.type === 'QUICK_ADD' && typeof msg.payload?.content === 'string') {
        void handleSaveTextNote(msg.payload.content, true)
        return
      }

      if (msg.type === 'SELECTION_CHANGED' && typeof msg.payload?.text === 'string') {
        setLookupQuery(msg.payload.text)
        return
      }

      if (msg.type === 'APP_ERROR' && typeof msg.payload?.message === 'string') {
        setError(msg.payload.message)
      }

      if (msg.type === 'FORM_KV_CACHE_GET' && typeof msg.payload?.signature === 'string') {
        const dirHandle = dirHandleRef.current
        if (!dirHandle) {
          sendResponse({ ok: false, reason: 'no-folder' })
          return true
        }
        void (async () => {
          try {
            const hash = await sha256Hex(msg.payload?.signature ?? '')
            const cacheFile = `${hash}.json`
            const cached = await readFormKVCacheEntry(dirHandle, cacheFile)
            sendResponse({ ok: true, cached: cached?.mappings ?? null })
          } catch {
            sendResponse({ ok: false, reason: 'read-failed' })
          }
        })()
        return true
      }

      if (msg.type === 'FORM_KV_CACHE_SET' && typeof msg.payload?.signature === 'string') {
        const dirHandle = dirHandleRef.current
        if (!dirHandle) {
          sendResponse({ ok: false, reason: 'no-folder' })
          return true
        }
        void (async () => {
          try {
            const mappings = (msg.payload?.mappings ?? []) as FormKVMapping[]
            const hash = await sha256Hex(msg.payload?.signature ?? '')
            const cacheFile = `${hash}.json`
            await writeFormKVCacheEntry(dirHandle, cacheFile, {
              version: '1.0',
              signature: msg.payload?.signature ?? '',
              generatedAt: new Date().toISOString(),
              mappings,
            })
            sendResponse({ ok: true })
          } catch {
            sendResponse({ ok: false, reason: 'write-failed' })
          }
        })()
        return true
      }
    }

    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
    }
  }, [])

  useEffect(() => {
    // Keep key warning state in sync even if the key is updated in popup.
    const onStorageChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'local') return
      if (!changes.llmConfig) return
      const nextValue = changes.llmConfig.newValue as LLMConfig | undefined
      setNoLLM(!nextValue?.apiKey)
      if (nextValue?.apiKey) setError(null)
    }

    chrome.storage.onChanged.addListener(onStorageChanged)
    return () => chrome.storage.onChanged.removeListener(onStorageChanged)
  }, [])

  // Keep ref current and re-sync context whenever the selection changes
  useEffect(() => {
    selectedFilesRef.current = selectedFiles
    const dirHandle = dirHandleRef.current
    if (!dirHandle) return
    void syncContextToBackground(dirHandle)
  }, [selectedFiles])

  function patchFile(name: string, patch: Partial<FileEntry>) {
    setFiles(prev => prev.map(f => f.name === name ? { ...f, ...patch } : f))
  }

  function toggleFileSelection(name: string) {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  function clearSelection() {
    setSelectedFiles(new Set())
  }

  async function syncContextToBackground(dirHandle: FileSystemDirectoryHandle): Promise<DocumentIndex[]> {
    const manifest = await readManifest(dirHandle)
    const documents: DocumentIndex[] = []
    const filter = selectedFilesRef.current

    for (const doc of manifest.documents) {
      // When the user has checked specific files, only include those
      if (filter.size > 0 && !filter.has(doc.fileName)) continue
      const entry = await readIndexEntry(dirHandle, doc.indexFile)
      if (!entry) continue
      if (doc.searchIndexFile) {
        const searchIndex = await readSearchIndexEntry(dirHandle, doc.searchIndexFile)
        if (searchIndex) entry.searchIndex = searchIndex
      }
      documents.push(entry)
    }
    setIndexedDocs(documents)

    chrome.runtime.sendMessage({
      type: 'CONTEXT_UPDATED',
      payload: { documents },
    })

    return documents
  }

  /** Core indexing loop — called by both the folder button and the refresh button. */
  async function runIndexing(rawFiles: File[], dirHandle: FileSystemDirectoryHandle, llmConfig: LLMConfig | undefined) {
    setFiles(rawFiles.map(f => ({ name: f.name, size: f.size, status: 'pending' })))

    for (const file of rawFiles) {
      patchFile(file.name, { status: 'indexing', phase: 'parsing' })
      try {
        const result = await indexWithOptionalOverride(
          file,
          dirHandle,
          pct   => patchFile(file.name, { ocrProgress: pct }),
          phase => patchFile(file.name, { phase }),
          llmConfig
        )
        if (result.status === 'too-large') {
          patchFile(file.name, {
            status: 'too-large',
            error: `PDF too large (${result.pageCount} pages, max ${MAX_PDF_PAGES})`,
            phase: undefined,
          })
        } else {
          patchFile(file.name, {
            status: result.status === 'skipped' ? 'skipped' : 'indexed',
            phase: undefined,
            ocrProgress: undefined,
          })
        }
      } catch (err) {
        const msg = getErrorMessage(err)
        patchFile(file.name, { status: 'error', error: msg, phase: undefined })
      }
    }

    await syncContextToBackground(dirHandle)
  }

  async function handleChooseFolder() {
    setError(null)
    setNoLLM(false)
    setRefreshed(false)
    setBusy(true)
    try {
      const dirHandle = await requestFolderAccess()
      const rawFiles  = await listFiles(dirHandle)
      const llmConfig = await loadLLMConfig()

      // Store for refresh
      dirHandleRef.current = dirHandle
      rawFilesRef.current  = rawFiles

      setFolderName(dirHandle.name)
      if (!llmConfig?.apiKey) setNoLLM(true)
      setBusy(false)

      await runIndexing(rawFiles, dirHandle, llmConfig)
    } catch (err) {
      setBusy(false)
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setError('Folder permission denied. Please re-select and allow access.')
        return
      }
      setError('Could not access folder. Please try again.')
    }
  }

  async function handleRefresh() {
    const dirHandle = dirHandleRef.current

    if (!dirHandle) {
      // No folder selected yet — just re-check the key status
      const llmConfig = await loadLLMConfig()
      setNoLLM(!llmConfig?.apiKey)
      return
    }

    setError(null)
    setRefreshed(false)
    setBusy(true)

    try {
      const llmConfig = await loadLLMConfig()
      setNoLLM(!llmConfig?.apiKey)

      // Re-scan folder so refresh truly reloads current disk state.
      const latestFiles = await listFiles(dirHandle)
      rawFilesRef.current = latestFiles

      // Force re-index so LLM/entity extraction reruns with latest key.
      await markAllForReindex(dirHandle)
      await runIndexing(latestFiles, dirHandle, llmConfig)

      setRefreshed(true)
      setTimeout(() => setRefreshed(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function fileSubtext(f: FileEntry): string {
    if (f.status === 'indexing') {
      if (f.phase === 'ocr' && f.ocrProgress !== undefined) return `OCR ${f.ocrProgress}%`
      return f.phase ? PHASE_LABEL[f.phase] : '…'
    }
    if (f.status === 'error')     return f.error ?? 'Error'
    if (f.status === 'too-large') return f.error ?? 'PDF too large'
    if (f.status === 'skipped')   return 'Unchanged'
    return formatSize(f.size)
  }

  function openSettings() {
    chrome.windows.create({
      url: chrome.runtime.getURL('src/popup/index.html'),
      type: 'popup',
      width: 340,
      height: 420,
    })
  }

  const hasFolder = folderName !== null

  function screenshotFileName(date: Date): string {
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    const hh = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    return `screenshot-${yyyy}-${mm}-${dd}-${hh}${min}.png`
  }

  const lookupResults = useMemo((): LookupResult[] => {
    const q = lookupQuery.trim().toLowerCase()
    if (!q) return []

    const tokens = q.split(/\s+/).filter(Boolean)
    const scored: Array<LookupResult & { score: number }> = []

    for (const doc of indexedDocs) {
      if (doc.searchIndex?.autofill) {
        for (const [key, value] of Object.entries(doc.searchIndex.autofill)) {
          const keyReadable = key.replace(/_/g, ' ')
          const keyScore = tokens.reduce((acc, token) => acc + (keyReadable.includes(token) ? 4 : 0), 0)
          const valueScore = tokens.reduce((acc, token) => acc + (value.toLowerCase().includes(token) ? 2 : 0), 0)
          const score = keyScore + valueScore
          if (!score) continue

          scored.push({
            id: `${doc.id}-autofill-${key}-${value}`,
            label: keyReadable.replace(/\b\w/g, c => c.toUpperCase()),
            value,
            sourceFile: doc.fileName,
            sourcePage: 1,
            sourceText: keyReadable,
            score: score + 40,
          })
        }
      }

      if (doc.searchIndex?.items?.length) {
        for (const item of doc.searchIndex.items) {
          const label = item.fieldLabel.toLowerCase()
          const value = item.value.toLowerCase()
          const aliasScore = (item.aliases ?? []).reduce(
            (acc, alias) => acc + tokens.reduce((inner, token) => inner + (alias.toLowerCase().includes(token) ? 1 : 0), 0),
            0
          )
          const labelScore = tokens.reduce((acc, token) => acc + (label.includes(token) ? 3 : 0), 0)
          const valueScore = tokens.reduce((acc, token) => acc + (value.includes(token) ? 2 : 0), 0)
          const score = labelScore + valueScore + aliasScore
          if (!score) continue

          scored.push({
            id: `${doc.id}-search-${item.fieldLabel}-${item.value}`,
            label: item.fieldLabel,
            value: item.value,
            sourceFile: doc.fileName,
            sourcePage: 1,
            sourceText: item.sourceText || item.value,
            score: score + 30,
          })
        }
      }

      for (const page of doc.pages) {
        for (const field of page.fields) {
          const label = field.label.toLowerCase()
          const value = field.value.toLowerCase()
          const labelScore = tokens.reduce((acc, token) => acc + (label.includes(token) ? 2 : 0), 0)
          const valueScore = tokens.reduce((acc, token) => acc + (value.includes(token) ? 1 : 0), 0)
          const score = labelScore + valueScore
          if (!score) continue

          scored.push({
            id: `${doc.id}-${page.page}-${field.label}-${field.value}`,
            label: field.label,
            value: field.value,
            sourceFile: doc.fileName,
            sourcePage: page.page,
            sourceText: field.boundingContext || field.value,
            score: score + 10,
          })
        }
      }
    }

    const deduped = new Map<string, LookupResult & { score: number }>()
    for (const item of scored) {
      const key = `${item.value}|${item.sourceFile}|${item.sourcePage ?? 0}`
      const existing = deduped.get(key)
      if (!existing || item.score > existing.score) deduped.set(key, item)
    }

    return [...deduped.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ score: _score, ...rest }) => rest)
  }, [lookupQuery, indexedDocs])

  async function copyLookupValue(item: LookupResult): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.value)
      setCopiedId(item.id)
      setCopyLog(prev => [{ label: item.label, value: item.value, copiedAt: new Date().toISOString() }, ...prev].slice(0, 20))
      setTimeout(() => setCopiedId(null), 1200)
    } catch {
      setError('Clipboard copy failed. Please copy manually.')
    }
  }

  async function handleCaptureScreenshot(): Promise<void> {
    const dirHandle = dirHandleRef.current
    if (!dirHandle) {
      setError('Choose a folder before capturing screenshots.')
      return
    }

    try {
      setScreenshotStatus('indexing')
      setError(null)

      const blob = await captureVisibleTabPng()
      const fileName = screenshotFileName(new Date())

      await writeFileToFolder(dirHandle, fileName, blob)

      const screenshotFile = new File([blob], fileName, { type: 'image/png' })
      const llmConfig = await loadLLMConfig()

      setFiles(prev => [
        { name: fileName, size: screenshotFile.size, status: 'indexing', phase: 'ocr' },
        ...prev,
      ])

      const result = await indexWithOptionalOverride(
        screenshotFile,
        dirHandle,
        pct => patchFile(fileName, { ocrProgress: pct }),
        phase => patchFile(fileName, { phase }),
        llmConfig
      )

      if (result.status === 'too-large') {
        patchFile(fileName, {
          status: 'too-large',
          phase: undefined,
          error: `Screenshot too large (${result.pageCount} pages, max ${MAX_PDF_PAGES})`,
        })
      } else if (result.status === 'skipped') {
        patchFile(fileName, { status: 'skipped', phase: undefined, ocrProgress: undefined })
      } else {
        patchFile(fileName, { status: 'indexed', phase: undefined, ocrProgress: undefined })
      }

      rawFilesRef.current = [screenshotFile, ...rawFilesRef.current]
      await syncContextToBackground(dirHandle)
      setScreenshotStatus('ready')
      setTimeout(() => setScreenshotStatus('idle'), 2500)
    } catch (err) {
      setScreenshotStatus('error')
      setError(getErrorMessage(err, 'Failed to capture screenshot.'))
      setTimeout(() => setScreenshotStatus('idle'), 2500)
    }
  }

  async function addFileToContext(file: File): Promise<void> {
    const dirHandle = dirHandleRef.current
    if (!dirHandle) {
      setError('Choose a folder before adding files.')
      return
    }

    const llmConfig = await loadLLMConfig()
    patchFile(file.name, { status: 'indexing', phase: 'parsing', ocrProgress: undefined, error: undefined })

    try {
      await writeFileToFolder(dirHandle, file.name, file)

      const result = await indexWithOptionalOverride(
        file,
        dirHandle,
        pct => patchFile(file.name, { ocrProgress: pct }),
        phase => patchFile(file.name, { phase }),
        llmConfig
      )

      if (result.status === 'too-large') {
        patchFile(file.name, {
          status: 'too-large',
          phase: undefined,
          error: `PDF too large (${result.pageCount} pages, max ${MAX_PDF_PAGES})`,
        })
      } else if (result.status === 'skipped') {
        patchFile(file.name, { status: 'skipped', phase: undefined, ocrProgress: undefined })
      } else {
        patchFile(file.name, { status: 'indexed', phase: undefined, ocrProgress: undefined })
      }

      rawFilesRef.current = [file, ...rawFilesRef.current.filter(f => f.name !== file.name)]
      await syncContextToBackground(dirHandle)
    } catch (err) {
      patchFile(file.name, {
        status: 'error',
        phase: undefined,
        error: getErrorMessage(err, 'Failed to add file.'),
      })
    }
  }

  async function processDroppedFiles(dropped: File[]): Promise<void> {
    if (!dropped.length) return
    for (const file of dropped) {
      if (!isSupported(file.name)) {
        setError(`Unsupported file type: ${file.name}`)
        continue
      }
      setFiles(prev => [{ name: file.name, size: file.size, status: 'pending' }, ...prev])
      await addFileToContext(file)
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    setDropActive(false)
    await processDroppedFiles(Array.from(event.dataTransfer.files))
  }

  async function handleSaveTextNote(noteOverride?: string, fromQuickAdd = false): Promise<void> {
    const dirHandle = dirHandleRef.current
    if (!dirHandle) {
      setError('Choose a folder before saving notes.')
      return
    }

    const content = (noteOverride ?? quickNote).trim()
    if (!content) return

    const now = new Date()
    const noteName = `note-${now.toISOString().replace(/[:.]/g, '-')}.txt`
    const noteFile = new File([content], noteName, { type: 'text/plain' })

    setFiles(prev => [{ name: noteName, size: noteFile.size, status: 'pending' }, ...prev])
    await addFileToContext(noteFile)

    if (!fromQuickAdd) setQuickNote('')
  }

  function parseRequestedFields(input: string): string[] {
    return input
      .split(/\n|,/)
      .map(v => v.trim())
      .filter(Boolean)
      .slice(0, 25)
  }

  async function handleManualFieldFetch(): Promise<void> {
    const fields = parseRequestedFields(fieldsToFetch)
    if (!fields.length) {
      setError('Paste one or more field names to fetch.')
      return
    }
    const dirHandle = dirHandleRef.current
    if (!dirHandle) {
      setError('Choose a folder first.')
      return
    }

    setManualFetchBusy(true)
    setError(null)
    try {
      const syncedDocs = await syncContextToBackground(dirHandle)
      if (!syncedDocs.length) {
        setError('No indexed documents are selected.')
        setManualFieldResults([])
        return
      }

      const response = await chrome.runtime.sendMessage({
        type: 'MANUAL_FIELD_FETCH',
        payload: { fields },
      }) as {
        ok?: boolean
        message?: string
        reason?: string
        results?: Array<{
          fieldLabel: string
          value: string
          sourceFile: string
          sourcePage?: number
        }>
      } | undefined
      if (!response?.ok) {
        setError(response?.message || 'Could not fetch fields from selected docs.')
        setManualFieldResults([])
        return
      }
      const results = (response.results ?? []).map((item, idx) => ({
        id: `${item.fieldLabel}-${item.value}-${idx}`,
        fieldLabel: item.fieldLabel,
        value: item.value,
        sourceFile: item.sourceFile,
        sourcePage: item.sourcePage,
      }))
      setManualFieldResults(results)
      if (!results.length) {
        setError(response.reason || 'No matching values found for the requested fields.')
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to fetch fields from docs.'))
    } finally {
      setManualFetchBusy(false)
    }
  }

  async function copyManualFieldValue(item: ManualFieldResult): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.value)
      setManualCopiedId(item.id)
      setTimeout(() => setManualCopiedId(null), 1200)
    } catch {
      setError('Clipboard copy failed. Please copy manually.')
    }
  }

  return (
    <div style={styles.container}>

      {/* Title bar */}
      <div style={styles.titleRow}>
        <div>
          <h1 style={styles.title}>FormBuddy</h1>
          <p style={styles.subtitle}>Form assistant for this page</p>
        </div>
        <div style={styles.iconRow}>
          {hasFolder && (
            <button
              style={styles.iconBtn}
              onClick={() => void handleCaptureScreenshot()}
              disabled={busy || screenshotStatus === 'indexing'}
              title="Capture screenshot (Cmd/Ctrl+Shift+S)"
            >
              {screenshotStatus === 'indexing' ? '⏳' : '📸'}
            </button>
          )}
          <button
            style={styles.iconBtn}
            onClick={openSettings}
            title="Settings"
          >
            ⚙️
          </button>
          {hasFolder && (
            <button
              style={styles.iconBtn}
              onClick={handleRefresh}
              disabled={busy}
              title="Reload everything"
            >
              {busy ? '⏳' : refreshed ? '✓' : '↻'}
            </button>
          )}
        </div>
      </div>

      {/* Folder button */}
      <button
        style={{ ...styles.button, opacity: busy ? 0.7 : 1 }}
        onClick={handleChooseFolder}
        disabled={busy}
      >
        {busy ? 'Working…' : hasFolder ? '↺ Change Folder' : '📂 Choose Folder'}
      </button>

      {hasFolder && (
        <div
          style={{
            ...styles.dropZone,
            ...(dropActive ? styles.dropZoneActive : {}),
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDropActive(true)
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(e) => void handleDrop(e)}
        >
          Drag and drop files here to quick-add
        </div>
      )}

      {/* Warnings / feedback */}
      {noLLM && (
        <div style={styles.warningBox}>
          <span>⚠️ No API key set — extraction may not be clean.</span>
          <button style={styles.inlineBtn} onClick={openSettings}>Configure →</button>
        </div>
      )}
      {refreshed && <p style={styles.successMsg}>✓ Refreshed with latest settings</p>}
      {screenshotStatus === 'indexing' && <p style={styles.infoMsg}>Indexing screenshot...</p>}
      {screenshotStatus === 'ready' && <p style={styles.successMsg}>✓ Screenshot indexed and ready</p>}
      {error     && <p style={styles.errorMsg}>{error}</p>}

      {/* Folder label */}
      {folderName && <p style={styles.folderName}>📁 {folderName}</p>}
      {navInfo && (
        <div style={styles.navBox}>
          <span style={styles.navText}>
            Session: Page {navInfo.pageIndex} • {navInfo.domain}
          </span>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <>
          {selectedFiles.size > 0 && (
            <div style={styles.filterBanner}>
              <span>Using {selectedFiles.size} of {files.length} file{selectedFiles.size !== 1 ? 's' : ''}</span>
              <button style={styles.clearFilterBtn} onClick={clearSelection}>Use all</button>
            </div>
          )}
          <ul style={styles.list}>
            {files.map(f => (
              <li key={f.name} style={styles.item}>
                <input
                  type="checkbox"
                  checked={selectedFiles.has(f.name)}
                  onChange={() => toggleFileSelection(f.name)}
                  style={styles.checkbox}
                />
                <span>{getTypeInfo(f.name)?.icon ?? '📁'}</span>
                <span style={styles.fileName}>
                  {f.name}
                  <span style={styles.subtext}>{fileSubtext(f)}</span>
                </span>
                <span title={f.status}>{STATUS_ICON[f.status]}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {hasFolder && files.length === 0 && !busy && (
        <p style={styles.empty}>No supported files in this folder yet.</p>
      )}

      {hasFolder && (
        <div style={styles.panelCard}>
          <h2 style={styles.sectionTitle}>Fields From Doc</h2>
          <textarea
            style={styles.noteInput}
            value={fieldsToFetch}
            onChange={e => setFieldsToFetch(e.target.value)}
            placeholder="Paste field names from form (one per line), for example:\nDriver License Number\nIssue Date\nExpiration Date"
          />
          <button
            style={{ ...styles.noteSaveBtn, marginTop: '8px' }}
            onClick={() => void handleManualFieldFetch()}
            disabled={!hasFolder || manualFetchBusy}
          >
            {manualFetchBusy ? 'Fetching...' : 'Fetch Fields From Doc'}
          </button>
          {manualFieldResults.length > 0 && (
            <ul style={styles.feedList}>
              {manualFieldResults.map(item => (
                <li key={item.id} style={styles.lookupItem}>
                  <p style={styles.lookupLabel}>{item.fieldLabel}</p>
                  <p style={styles.lookupValue}>{item.value}</p>
                  <p style={styles.lookupSource}>
                    From: {item.sourceFile}{item.sourcePage ? `, Page ${item.sourcePage}` : ''}
                  </p>
                  <button style={styles.copyBtn} onClick={() => void copyManualFieldValue(item)}>
                    {manualCopiedId === item.id ? 'Copied' : 'Copy'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {hasFolder && (
        <div style={styles.panelCard}>
          <h2 style={styles.sectionTitle}>Quick Note</h2>
          <textarea
            style={styles.noteInput}
            value={quickNote}
            onChange={(e) => setQuickNote(e.target.value)}
            placeholder="Add a note, number, or detail you want FormBuddy to use."
          />
          <button style={styles.noteSaveBtn} onClick={() => void handleSaveTextNote()}>
            Save Note
          </button>
        </div>
      )}

      <div style={styles.panelCard}>
        <h2 style={styles.sectionTitle}>Search & Copy</h2>
        <input
          style={styles.lookupInput}
          value={lookupQuery}
          onChange={(e) => setLookupQuery(e.target.value)}
          placeholder="Search field (for example: passport number)"
        />
        {lookupQuery.trim().length === 0 ? (
          <p style={styles.feedEmpty}>Search your indexed data and copy values directly.</p>
        ) : lookupResults.length === 0 ? (
          <p style={styles.feedEmpty}>No matching values found.</p>
        ) : (
          <ul style={styles.feedList}>
            {lookupResults.map(item => (
              <li key={item.id} style={styles.lookupItem}>
                <p style={styles.lookupLabel}>{item.label}</p>
                <p style={styles.lookupValue}>{item.value}</p>
                <p style={styles.lookupSource}>
                  From: {item.sourceFile}{item.sourcePage ? `, Page ${item.sourcePage}` : ''}
                </p>
                <button style={styles.copyBtn} onClick={() => void copyLookupValue(item)}>
                  {copiedId === item.id ? 'Copied' : 'Copy'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={styles.panelCard}>
        <h2 style={styles.sectionTitle}>Copied This Session</h2>
        {copyLog.length === 0 ? (
          <p style={styles.feedEmpty}>Copied values will be tracked here.</p>
        ) : (
          <ul style={styles.feedList}>
            {copyLog.map((item, idx) => (
              <li key={`${item.copiedAt}-${idx}`} style={styles.feedItem}>
                {item.label} {'->'} {item.value}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: 'system-ui, sans-serif',
    padding: '16px',
    fontSize: '14px',
    color: '#111',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
  },
  title:   { fontSize: '18px', fontWeight: 700, margin: 0 },
  subtitle: {
    margin: '2px 0 0',
    fontSize: '11px',
    color: '#6b7280',
  },
  iconRow: { display: 'flex', gap: '4px' },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '18px',
    padding: '2px 4px',
    borderRadius: '4px',
  },
  button: {
    width: '100%',
    padding: '8px 12px',
    fontSize: '14px',
    fontWeight: 600,
    background: '#1a73e8',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  folderName: {
    margin: '10px 0 4px',
    fontWeight: 600,
    fontSize: '13px',
    color: '#444',
    wordBreak: 'break-all',
  },
  warningBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '8px',
    padding: '6px 8px',
    background: '#fffbeb',
    border: '1px solid #fcd34d',
    borderRadius: '5px',
    fontSize: '12px',
    color: '#92400e',
  },
  navBox: {
    marginTop: '8px',
    padding: '6px 8px',
    background: '#eef2ff',
    border: '1px solid #c7d2fe',
    borderRadius: '5px',
  },
  navText: {
    fontSize: '12px',
    color: '#3730a3',
    fontWeight: 600,
  },
  inlineBtn: {
    background: 'none',
    border: 'none',
    color: '#1a73e8',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
    padding: '0',
    whiteSpace: 'nowrap' as const,
  },
  successMsg: { margin: '8px 0 0', color: '#065f46', fontSize: '12px' },
  errorMsg:   { margin: '8px 0 0', color: '#d93025', fontSize: '13px' },
  infoMsg:    { margin: '8px 0 0', color: '#374151', fontSize: '12px' },
  empty:      { marginTop: '12px', color: '#888', fontSize: '13px' },
  dropZone: {
    marginTop: '10px',
    border: '1px dashed #9ca3af',
    borderRadius: '6px',
    padding: '10px',
    textAlign: 'center',
    fontSize: '12px',
    color: '#4b5563',
    background: '#f9fafb',
  },
  dropZoneActive: {
    borderColor: '#2563eb',
    background: '#eff6ff',
    color: '#1d4ed8',
  },
  list:       { margin: '6px 0 0', padding: 0, listStyle: 'none' },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 4px',
    borderBottom: '1px solid #f0f0f0',
  },
  fileName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'flex',
    flexDirection: 'column',
  },
  subtext: { fontSize: '11px', color: '#888', marginTop: '1px' },
  checkbox: { flexShrink: 0, cursor: 'pointer', accentColor: '#1a73e8' },
  filterBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '8px',
    padding: '5px 8px',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '5px',
    fontSize: '12px',
    color: '#1e40af',
    fontWeight: 600,
  },
  clearFilterBtn: {
    background: 'none',
    border: 'none',
    color: '#1a73e8',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
    padding: 0,
  },
  panelCard: {
    marginTop: '14px',
    border: '1px solid #e5e7eb',
    background: '#fbfdff',
    borderRadius: '8px',
    padding: '10px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '13px',
    color: '#1f2937',
    fontWeight: 700,
  },
  feedEmpty: {
    margin: '8px 0 0',
    fontSize: '12px',
    color: '#777',
  },
  feedList: {
    margin: '8px 0 0',
    padding: 0,
    listStyle: 'none',
    maxHeight: '140px',
    overflowY: 'auto',
  },
  feedItem: {
    fontSize: '12px',
    color: '#111',
    background: '#f7f7f7',
    borderRadius: '4px',
    padding: '6px 8px',
    marginBottom: '6px',
  },
  lookupInput: {
    width: '100%',
    boxSizing: 'border-box' as const,
    marginTop: '8px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    padding: '8px',
    fontSize: '12px',
  },
  lookupItem: {
    background: '#f8fafc',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '8px',
    marginBottom: '8px',
  },
  lookupLabel: {
    margin: '0 0 4px',
    fontSize: '12px',
    color: '#374151',
    fontWeight: 700,
  },
  lookupValue: {
    margin: 0,
    fontSize: '14px',
    color: '#111827',
    fontWeight: 700,
    wordBreak: 'break-word',
  },
  lookupSource: {
    margin: '6px 0 0',
    fontSize: '11px',
    color: '#4b5563',
  },
  copyBtn: {
    marginTop: '6px',
    padding: '4px 8px',
    fontSize: '11px',
    borderRadius: '4px',
    border: '1px solid #2563eb',
    background: '#eff6ff',
    color: '#1d4ed8',
    cursor: 'pointer',
    fontWeight: 600,
  },
  noteInput: {
    width: '100%',
    minHeight: '66px',
    boxSizing: 'border-box' as const,
    marginTop: '8px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    padding: '8px',
    fontSize: '12px',
    fontFamily: 'inherit',
    resize: 'vertical' as const,
  },
  noteSaveBtn: {
    marginTop: '8px',
    padding: '6px 10px',
    fontSize: '12px',
    borderRadius: '5px',
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
  },
  mappingStatusBar: {
    marginTop: '8px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    padding: '8px',
    fontSize: '12px',
    color: '#374151',
    background: '#f9fafb',
  },
  mappingStatusRunning: {
    borderColor: '#93c5fd',
    background: '#eff6ff',
    color: '#1d4ed8',
  },
  mappingStatusReady: {
    borderColor: '#86efac',
    background: '#ecfdf5',
    color: '#166534',
  },
  mappingStatusError: {
    borderColor: '#fca5a5',
    background: '#fef2f2',
    color: '#b91c1c',
  },
  mappingMetaRow: {
    marginTop: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mappingMetaText: {
    fontSize: '12px',
    color: '#374151',
    fontWeight: 600,
  },
}
