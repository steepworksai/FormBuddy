import { useEffect, useRef, useState } from 'react'
import './sidepanel.css'
import {
  Camera,
  BrainCircuit,
  Trash2,
  RotateCw,
  HelpCircle,
  Zap,
  Copy,
  Check,
  X,
  FolderOpen,
  Loader2,
} from 'lucide-react'
import { startTour, isTourDone } from './tour'
import { shortModelName } from '../lib/utils/modelName'
import { verifyApiKey } from '../lib/llm/verify'
import { requestFolderAccess, listFiles, writeFileToFolder } from '../lib/folder/access'
import { indexDocument } from '../lib/indexing/indexer'
import {
  clearFormKVCache,
  readFormKVCacheEntry,
  readIndexEntry,
  readManifest,
  writeFormKVCacheEntry,
  writeManifest,
} from '../lib/indexing/manifest'
import { getTypeInfo, isSupported } from '../lib/config/supportedTypes'
import { MAX_PDF_PAGES } from '../lib/parser/pdf'
import type { DocumentIndex, FormKVMapping, LLMConfig, LLMProvider } from '../types'
import type { IndexPhase } from '../lib/indexing/indexer'

interface FileEntry {
  name: string
  size: number
  status: 'pending' | 'indexing' | 'indexed' | 'skipped' | 'too-large' | 'error'
  phase?: IndexPhase
  ocrProgress?: number
  error?: string
}

interface FillResult {
  id: string
  fieldLabel: string
  value: string
  sourceFile: string
  sourcePage?: number
  filled: boolean
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

const PROVIDERS: { value: LLMProvider; label: string; models: string[]; url: string }[] = [
  { value: 'anthropic', label: 'Anthropic Claude', models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'], url: 'https://console.anthropic.com' },
  { value: 'openai',    label: 'OpenAI',           models: ['gpt-4o', 'gpt-4o-mini'],                                            url: 'https://platform.openai.com' },
  { value: 'gemini',    label: 'Google Gemini',    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],     url: 'https://aistudio.google.com/app/apikey' },
]

function SettingsPanel({ onClose, onSaved }: { onClose: () => void; onSaved: (model: string) => void }) {
  const [provider, setProvider] = useState<LLMProvider>('gemini')
  const [model, setModel]       = useState(PROVIDERS[2].models[0])
  const [apiKey, setApiKey]     = useState('')
  const [status, setStatus]     = useState<'idle' | 'verifying' | 'connected' | 'invalid' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  useEffect(() => {
    chrome.storage.local.get('llmConfig', r => {
      const cfg = r.llmConfig as LLMConfig | undefined
      if (!cfg) return
      setProvider(cfg.provider)
      setModel(cfg.model)
      setApiKey(cfg.apiKey)
      setStatus('connected')
    })
  }, [])

  const providerInfo = PROVIDERS.find(p => p.value === provider)!

  function handleProviderChange(p: LLMProvider) {
    setProvider(p)
    setModel(PROVIDERS.find(x => x.value === p)!.models[0])
    if (status === 'connected') setStatus('idle')
  }

  async function handleSave() {
    const key = apiKey.trim()
    if (!key) { setStatus('invalid'); setErrorMsg('API key is required.'); return }
    setStatus('verifying')
    setErrorMsg('')
    const config: LLMConfig = { provider, model, apiKey: key }
    try {
      const valid = await verifyApiKey(config)
      if (!valid) { setStatus('invalid'); setErrorMsg('Invalid key — check it and try again.'); return }
      await new Promise<void>(resolve => chrome.storage.local.set({ llmConfig: config }, resolve))
      setStatus('connected')
      onSaved(model)
      const host = new URL(providerInfo.url).host
      chrome.tabs.query({ url: `*://${host}/*` }, tabs => {
        tabs.forEach(t => { if (t.id) chrome.tabs.remove(t.id, () => void chrome.runtime.lastError) })
      })
      setTimeout(onClose, 700)
    } catch {
      setStatus('error')
      setErrorMsg('Network error — check your connection and try again.')
    }
  }

  async function handleDisconnect() {
    await new Promise<void>(resolve => chrome.storage.local.remove('llmConfig', resolve))
    setApiKey('')
    setStatus('idle')
    setErrorMsg('')
  }

  const busy = status === 'verifying'
  const buttonLabel =
    status === 'verifying' ? 'Verifying…' :
    status === 'connected' ? '✓ Connected' :
    'Verify & Save'

  return (
    <div style={sp.overlay}>
      <div style={sp.header}>
        <span style={sp.title}>AI Settings</span>
        <button style={sp.closeBtn} onClick={onClose} aria-label="Close settings">
          <X size={18} />
        </button>
      </div>
      <div style={sp.body}>
        <label style={sp.label}>Provider</label>
        <select style={sp.select} value={provider} onChange={e => handleProviderChange(e.target.value as LLMProvider)} disabled={busy}>
          {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        {provider === 'gemini' ? (
          <div style={sp.freeCallout}>
            <span style={sp.freeBadge}>FREE</span>
            <span style={sp.freeText}>No credit card needed · 1,500 requests/day free</span>
            <button style={sp.freeLink} onClick={() => chrome.tabs.create({ url: providerInfo.url })}>
              Get your free Gemini key ↗
            </button>
          </div>
        ) : (
          <button style={sp.linkButton} onClick={() => chrome.tabs.create({ url: providerInfo.url })}>
            Get API key from {providerInfo.label} ↗
          </button>
        )}

        <label style={sp.label}>Model</label>
        <select style={sp.select} value={model} onChange={e => { setModel(e.target.value); if (status === 'connected') setStatus('idle') }} disabled={busy}>
          {providerInfo.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <label style={sp.label}>API Key</label>
        <input
          style={{ ...sp.input, borderColor: status === 'invalid' ? '#d93025' : '#d1d5db' }}
          type="password"
          placeholder="Paste your API key here"
          value={apiKey}
          onChange={e => { setApiKey(e.target.value); if (status !== 'idle') setStatus('idle') }}
          disabled={busy}
        />

        <div style={sp.row}>
          <button
            style={{ ...sp.button, opacity: busy ? 0.7 : 1, background: status === 'connected' ? '#059669' : '#1a73e8' }}
            onClick={() => void handleSave()}
            disabled={busy || status === 'connected'}
          >
            {buttonLabel}
          </button>
          {status === 'connected' && (
            <button style={sp.disconnectButton} onClick={() => void handleDisconnect()}>Disconnect</button>
          )}
        </div>

        {status === 'invalid'   && <p style={sp.invalidMsg}>✗ {errorMsg}</p>}
        {status === 'error'     && <p style={sp.errorMsg_}>⚠ {errorMsg}</p>}
        {status === 'verifying' && <p style={sp.infoMsg}>Making a test call to verify your key…</p>}
        {status === 'connected' && <p style={sp.connectedMsg}>● Connected — settings saved</p>}
      </div>
    </div>
  )
}

const sp: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: '#fff',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '13px',
    color: '#111',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px 12px',
    borderBottom: '1px solid #e5e7eb',
    flexShrink: 0,
  },
  title: { fontSize: '15px', fontWeight: 700 },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#6b7280',
    padding: '2px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
  },
  body: { padding: '4px 16px 16px', overflowY: 'auto' as const, flex: 1 },
  label: {
    display: 'block',
    fontWeight: 600,
    fontSize: '12px',
    marginBottom: '4px',
    marginTop: '14px',
    color: '#374151',
  },
  select: {
    width: '100%',
    padding: '7px 8px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    fontSize: '13px',
    boxSizing: 'border-box' as const,
    background: '#fff',
  },
  input: {
    width: '100%',
    padding: '7px 8px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    fontSize: '13px',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#1a73e8',
    cursor: 'pointer',
    fontSize: '11px',
    padding: '3px 0 0',
    display: 'block',
  },
  row: { display: 'flex', gap: '8px', marginTop: '16px' },
  button: {
    flex: 1,
    padding: '9px',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: '13px',
  },
  disconnectButton: {
    padding: '9px 14px',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  freeCallout: {
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '6px',
    padding: '8px 10px',
    marginTop: '6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '3px',
  },
  freeBadge: {
    display: 'inline-block',
    background: '#059669',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: '999px',
    width: 'fit-content',
  },
  freeText: { fontSize: '11px', color: '#065f46' },
  freeLink: {
    display: 'inline-block',
    marginTop: '2px',
    background: '#059669',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center' as const,
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  invalidMsg:   { color: '#d93025', fontSize: '12px', margin: '10px 0 0' },
  errorMsg_:    { color: '#b45309', fontSize: '12px', margin: '10px 0 0' },
  infoMsg:      { color: '#6b7280', fontSize: '11px', margin: '10px 0 0' },
  connectedMsg: { color: '#059669', fontSize: '12px', fontWeight: 600, margin: '10px 0 0' },
}

export default function SidePanel() {
  const [files, setFiles]         = useState<FileEntry[]>([])
  const [folderName, setFolderName] = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [busy, setBusy]           = useState(false)
  const [noLLM, setNoLLM]         = useState(false)
  const [activeModel, setActiveModel] = useState<string>('')
  const [refreshed, setRefreshed] = useState(false)
  const [navInfo, setNavInfo] = useState<{ pageIndex: number; domain: string; url: string } | null>(null)
  const [screenshotStatus, setScreenshotStatus] = useState<'idle' | 'indexing' | 'ready'>('idle')
  const [dropActive, setDropActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [fillBusy, setFillBusy] = useState(false)
  const [fillDone, setFillDone] = useState(false)
  const [fillPhase, setFillPhase] = useState<'scanning' | 'fetching' | 'filling' | null>(null)
  const [fillResults, setFillResults] = useState<FillResult[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [tableCollapsed, setTableCollapsed] = useState(false)
  const [cacheCleared, setCacheCleared] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Persist between renders without triggering re-renders
  const dirHandleRef       = useRef<FileSystemDirectoryHandle | null>(null)
  const rawFilesRef        = useRef<File[]>([])
  const selectedFilesRef   = useRef<Set<string>>(new Set())
  const syncTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Seed activeModel from storage on mount
  useEffect(() => {
    void loadLLMConfig().then(cfg => {
      if (cfg?.apiKey) setActiveModel(shortModelName(cfg.model))
    })
  }, [])

  // Auto-start tour on very first visit
  useEffect(() => {
    const disableTour = (window as unknown as { __FORMBUDDY_DISABLE_TOUR__?: boolean }).__FORMBUDDY_DISABLE_TOUR__
    if (disableTour) return
    void isTourDone().then(done => {
      if (!done) startTour(false)
    })
  }, [])

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
          documents?: Array<{ fileName: string; cleanText: string }>
          requestedFields?: string[]
          status?: 'idle' | 'running' | 'ready' | 'error'
          count?: number
          cached?: boolean
          generatedAt?: string
          reason?: string
          stage?: string
        }
      }

      if (msg.type === 'PAGE_NAVIGATED' && msg.payload?.url) {
        // Every navigation is a potentially different form — clear previous results
        setFillResults([])
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
            const documents = (msg.payload?.documents ?? []) as Array<{ fileName: string; cleanText: string }>
            const requestedFields = (msg.payload?.requestedFields ?? []) as string[]
            const hash = await sha256Hex(msg.payload?.signature ?? '')
            const cacheFile = `${hash}.json`
            await writeFormKVCacheEntry(dirHandle, cacheFile, {
              version: '1.0',
              signature: msg.payload?.signature ?? '',
              generatedAt: new Date().toISOString(),
              documents,
              requestedFields,
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
      setActiveModel(nextValue?.apiKey ? shortModelName(nextValue.model) : '')
      if (nextValue?.apiKey) setError(null)
    }

    chrome.storage.onChanged.addListener(onStorageChanged)
    return () => chrome.storage.onChanged.removeListener(onStorageChanged)
  }, [])

  // Keep ref current and re-sync context whenever the selection changes (debounced 300 ms)
  useEffect(() => {
    selectedFilesRef.current = selectedFiles
    const dirHandle = dirHandleRef.current
    if (!dirHandle) return
    if (syncTimerRef.current !== null) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null
      void syncContextToBackground(dirHandle)
    }, 300)
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

  async function queryFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      const perm = await handle.queryPermission({ mode: 'readwrite' })
      return perm === 'granted'
    } catch {
      return false
    }
  }

  function resetFolderState(reason: string) {
    dirHandleRef.current = null
    rawFilesRef.current = []
    setFolderName(null)
    setFiles([])
    setError(reason)
  }

  async function syncContextToBackground(dirHandle: FileSystemDirectoryHandle): Promise<DocumentIndex[]> {
    if (!(await queryFolderPermission(dirHandle))) {
      resetFolderState('Folder access expired. Please reconnect your documents.')
      return []
    }
    const manifest = await readManifest(dirHandle)
    const documents: DocumentIndex[] = []
    const filter = selectedFilesRef.current


    for (const doc of manifest.documents) {
      // When the user has checked specific files, only include those
      if (filter.size > 0 && !filter.has(doc.fileName)) continue
      const entry = await readIndexEntry(dirHandle, doc.indexFile)
      if (!entry) continue
      documents.push(entry)
    }
    await chrome.runtime.sendMessage({
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

    if (!(await queryFolderPermission(dirHandle))) {
      resetFolderState('Folder access expired. Please reconnect your documents.')
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

  const hasFolder = folderName !== null

  function screenshotFileName(date: Date): string {
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    const hh = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    return `screenshot-${yyyy}-${mm}-${dd}-${hh}${min}.png`
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
      setError(getErrorMessage(err, 'Failed to capture screenshot.'))
      setScreenshotStatus('idle')
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

  async function handleScanAndFill(): Promise<void> {
    const dirHandle = dirHandleRef.current
    if (!dirHandle) {
      setError('Choose a folder first.')
      return
    }

    setFillBusy(true)
    setFillDone(false)
    setFillPhase('scanning')
    setFillResults([])
    setTableCollapsed(false)
    setError(null)

    try {
      // Step 1: Detect form fields on the active page
      const scanResp = await chrome.runtime.sendMessage({ type: 'GET_PAGE_FIELDS' }) as
        | { ok: boolean; fields: Array<{ fieldLabel: string; placeholder?: string }>; reason?: string }
        | undefined
      const scannedFields = (scanResp?.fields ?? [])
        .filter(f => f.fieldLabel?.trim())
        .map(f => ({ fieldLabel: f.fieldLabel.trim(), placeholder: f.placeholder }))
      if (!scannedFields.length) {
        setError(scanResp?.reason ?? 'No form fields detected. Make sure you are on a web form.')
        return
      }

      // Step 2: Push indexed docs to background
      setFillPhase('fetching')
      const syncedDocs = await syncContextToBackground(dirHandle)
      if (!syncedDocs.length) {
        setError('No indexed documents are selected.')
        return
      }

      // Step 3: Find matching values from documents
      const fetchResp = await chrome.runtime.sendMessage({
        type: 'MANUAL_FIELD_FETCH',
        payload: { fields: scannedFields },
      }) as {
        ok?: boolean
        message?: string
        reason?: string
        results?: Array<{ fieldLabel: string; value: string; sourceFile: string; sourcePage?: number }>
      } | undefined

      if (!fetchResp?.ok) {
        setError(fetchResp?.message || 'Could not match field values from your documents.')
        return
      }
      const matched = (fetchResp.results ?? []).map((item, idx) => ({
        id: `${item.fieldLabel}-${idx}`,
        fieldLabel: item.fieldLabel,
        value: item.value,
        sourceFile: item.sourceFile,
        sourcePage: item.sourcePage,
        filled: false,
      }))
      if (!matched.length) {
        setError(fetchResp.reason || 'No matching values found in your documents.')
        return
      }

      // Step 4: Auto-fill the form
      setFillPhase('filling')
      const fillResp = await chrome.runtime.sendMessage({
        type: 'BULK_AUTOFILL',
        payload: { mappings: matched.map(r => ({ fieldLabel: r.fieldLabel, value: r.value })) },
      }) as { ok: boolean; filled?: number; skipped?: string[]; reason?: string } | undefined

      const skippedSet = new Set(fillResp?.skipped ?? [])
      const results = matched.map(r => ({ ...r, filled: !skippedSet.has(r.fieldLabel) }))
      setFillResults(results)
      setFillDone(true)

    } catch (err) {
      setError(getErrorMessage(err, 'Scan & fill failed. Please try again.'))
    } finally {
      setFillBusy(false)
      setFillPhase(null)
    }
  }

  async function handleClearCache(): Promise<void> {
    const dirHandle = dirHandleRef.current
    if (!dirHandle) return
    await clearFormKVCache(dirHandle)
    setCacheCleared(true)
    setTimeout(() => setCacheCleared(false), 2500)
  }

  async function copyValue(id: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1200)
    } catch {
      setError('Clipboard copy failed.')
    }
  }

  return (
    <div className="fb-root" style={styles.container}>
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onSaved={(savedModel) => {
            setActiveModel(shortModelName(savedModel))
            setNoLLM(false)
            setError(null)
            if (dirHandleRef.current && files.some(f => f.status === 'error')) {
              void handleRefresh()
            }
          }}
        />
      )}
      <div className="fb-bg" aria-hidden="true">
        <div className="fb-bg__blob fb-bg__blob--a" />
        <div className="fb-bg__blob fb-bg__blob--b" />
        <div className="fb-bg__blob fb-bg__blob--c" />
      </div>
      <div className="fb-content">

      {/* Title bar */}
      <div style={styles.titleRow}>
        <div style={styles.brandRow}>
          <img
            src={chrome.runtime.getURL('icons/icon48.png')}
            alt="FormBuddy"
            style={styles.brandIcon}
          />
          <p style={styles.subtitle}>Form assistant for this page</p>
        </div>
        <div style={styles.iconRow}>
          {hasFolder && (
            <button
              style={styles.iconBtn}
              onClick={() => void handleCaptureScreenshot()}
              disabled={busy || screenshotStatus === 'indexing'}
              title="Capture screenshot"
              aria-label="Capture screenshot"
            >
              {screenshotStatus === 'indexing'
                ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                : <Camera size={16} />}
            </button>
          )}
          {activeModel && (
            <span style={styles.modelPill} title={`Active model: ${activeModel}`}>
              {activeModel}
            </span>
          )}
          <button
            id="fb-settings-btn"
            style={styles.iconBtn}
            onClick={() => setSettingsOpen(true)}
            title="AI Settings"
            aria-label="AI Settings"
          >
            <BrainCircuit size={16} />
          </button>
          {hasFolder && (
            <button
              style={styles.iconBtn}
              onClick={() => void handleClearCache()}
              title="Clear field cache"
              aria-label="Clear field cache"
            >
              {cacheCleared ? <Check size={16} color="#059669" /> : <Trash2 size={16} />}
            </button>
          )}
          {hasFolder && (
            <button
              style={styles.iconBtn}
              onClick={handleRefresh}
              disabled={busy}
              title="Reload everything"
              aria-label="Reload everything"
            >
              {refreshed
                ? <Check size={16} color="#059669" />
                : <RotateCw size={16} style={busy ? { animation: 'spin 1s linear infinite' } : {}} />}
            </button>
          )}
          <button
            style={styles.tourBtn}
            onClick={() => startTour(hasFolder)}
            title="Take a tour"
            aria-label="Take a tour"
          >
            <HelpCircle size={14} />
          </button>
        </div>
      </div>

      {/* Connect documents card */}
      <button
        id="fb-choose-folder"
        style={{ ...styles.folderCard, opacity: busy ? 0.75 : 1 }}
        onClick={handleChooseFolder}
        disabled={busy}
        title={hasFolder ? 'Switch to a different document folder' : 'Choose a folder to index documents'}
        aria-label={hasFolder ? 'Switch document folder' : 'Choose document folder'}
      >
        <span style={styles.folderCardIcon}>
          {busy
            ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            : hasFolder
              ? <RotateCw size={20} />
              : <FolderOpen size={20} />}
        </span>
        <span style={styles.folderCardText}>
          <span style={styles.folderCardTitle}>
            {busy ? 'Loading…' : hasFolder ? 'Switch Document Folder' : 'Connect Your Documents'}
          </span>
          <span style={styles.folderCardHint}>
            {busy
              ? 'Indexing your files, hang tight…'
              : hasFolder
                ? `${folderName} · tap to switch to a different folder`
                : 'Pick a folder of PDFs, images or notes to fill forms from'}
          </span>
        </span>
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
          <button style={styles.inlineBtn} onClick={() => setSettingsOpen(true)}>Configure →</button>
        </div>
      )}
      {error && !hasFolder && (
        <div style={styles.errorBanner} role="alert">
          {error}
        </div>
      )}
      {refreshed && <p style={styles.successMsg}>✓ Refreshed with latest settings</p>}
      {screenshotStatus === 'indexing' && <p style={styles.infoMsg}>Indexing screenshot...</p>}
      {screenshotStatus === 'ready' && <p style={styles.successMsg}>✓ Screenshot indexed and ready</p>}
      {navInfo && (
        <div style={styles.navBox}>
          <span style={styles.navText}>
            Session: Page {navInfo.pageIndex} • {navInfo.domain}
          </span>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div id="fb-file-list">
          {selectedFiles.size > 0 && (
            <div style={styles.filterBanner}>
              <span>Using {selectedFiles.size} of {files.length} file{selectedFiles.size !== 1 ? 's' : ''}</span>
              <button
                style={styles.clearFilterBtn}
                onClick={clearSelection}
                title="Search across all indexed files"
                aria-label="Use all files"
              >
                Use all
              </button>
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
        </div>
      )}

      {hasFolder && files.length === 0 && !busy && (
        <p style={styles.empty}>No supported files in this folder yet.</p>
      )}

      {hasFolder && (
        <div id="fb-fill-section" style={styles.panelCard}>
          <h2 style={styles.sectionTitle}>Fill From My Docs</h2>
          <p style={styles.sectionHint}>Scans this page's form fields, matches values from your documents, and fills everything automatically.</p>

          {/* Error with retry — shown just above the action button */}
          {error && (
            <div style={styles.errorRow}>
              <p style={styles.errorMsg}>{error}</p>
          <button
            style={{ ...styles.retryBtn, opacity: fillBusy ? 0.45 : 1, cursor: fillBusy ? 'default' : 'pointer' }}
            disabled={fillBusy}
            onClick={() => { setError(null); void handleScanAndFill() }}
          >
            <RotateCw size={11} /> Retry
          </button>
            </div>
          )}

          {/* Single action button */}
          <button
            id="fb-scan-btn"
            style={{ ...styles.fillBtn, opacity: fillBusy ? 0.75 : 1 }}
            onClick={() => void handleScanAndFill()}
            disabled={fillBusy}
            title="Scan this page, find values from your docs, and auto-fill the form"
            aria-label="Scan and auto fill"
          >
            {fillBusy ? (
              <>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                {fillPhase === 'scanning' ? 'Scanning form…'
                  : fillPhase === 'fetching' ? 'Finding values…'
                  : 'Filling form…'}
              </>
            ) : (
              <><Zap size={16} /> Scan &amp; Auto Fill</>
            )}
          </button>

          {/* Hare race status bar */}
          {(fillBusy || fillDone) && (
            <div style={{ ...styles.statusBar, ...(fillDone ? styles.statusBarDone : {}) }}>
              <div style={styles.statusTrack}>
                <div style={fillDone ? styles.statusTrackDone : styles.statusTrackFill} />
                <span style={fillDone ? styles.hareDone : styles.hare}>🐇</span>
                <span style={styles.finishFlag}>{fillDone ? '🏆' : '🏁'}</span>
              </div>
              <p style={{ ...styles.statusLabel, ...(fillDone ? styles.statusLabelDone : {}) }}>
                {fillDone
                  ? `✨ All done! ${fillResults.length} field${fillResults.length !== 1 ? 's' : ''} filled`
                  : fillPhase === 'scanning'
                    ? 'Detecting form fields on this page…'
                    : fillPhase === 'fetching'
                      ? 'Searching your documents for values…'
                      : 'Filling the form fields…'}
              </p>
            </div>
          )}

          {/* Results table */}
          {fillResults.length > 0 && (
            <div style={styles.tableWrap}>
              <button
                style={styles.tableToggle}
                onClick={() => setTableCollapsed(c => !c)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Check size={12} color="#059669" />
                  {fillResults.length} field{fillResults.length !== 1 ? 's' : ''} filled
                </span>
                <span style={{
                  display: 'inline-block',
                  transform: tableCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                  fontSize: '10px',
                  color: '#9ca3af',
                }}>▼</span>
              </button>
              {!tableCollapsed && (
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Field</th>
                        <th style={styles.th}>Value</th>
                        <th style={{ ...styles.th, width: '44px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {fillResults.map(item => (
                        <tr key={item.id} style={styles.tr}>
                          <td style={styles.tdField}>{item.fieldLabel}</td>
                          <td style={styles.tdValue} title={item.value}>{item.value}</td>
                          <td style={styles.tdAction}>
                            <button
                              style={styles.copyBtn}
                              onClick={() => void copyValue(item.id, item.value)}
                              title="Copy value"
                            >
                              {copiedId === item.id
                                ? <Check size={11} color="#059669" />
                                : <Copy size={11} />}
                            </button>
                            {item.filled
                              ? <Check size={13} color="#059669" style={{ marginLeft: '4px' }} />
                              : <X size={13} color="#9ca3af" style={{ marginLeft: '4px' }} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
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
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
  },
  brandIcon: {
    width: '38px',
    height: '38px',
    borderRadius: '8px',
    flexShrink: 0,
    boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
  },
  subtitle: {
    margin: 0,
    fontSize: '12.5px',
    color: '#6b7280',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  iconRow: { display: 'flex', gap: '4px', alignItems: 'center' },
  modelPill: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#6366f1',
    background: '#ede9fe',
    border: '1px solid #c4b5fd',
    borderRadius: '99px',
    padding: '2px 7px',
    letterSpacing: '0.2px',
    whiteSpace: 'nowrap' as const,
    maxWidth: '80px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '18px',
    padding: '2px 4px',
    borderRadius: '4px',
  },
  tourBtn: {
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 700,
    color: '#fff',
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    boxShadow: '0 2px 6px rgba(99,102,241,0.45)',
    flexShrink: 0,
  },
  folderCard: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 14px',
    background: '#fff',
    border: '1.5px solid #e5e7eb',
    borderRadius: '12px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  folderCardIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '38px',
    height: '38px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
    color: '#7c3aed',
    flexShrink: 0,
  },
  folderCardText: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
    minWidth: 0,
  },
  folderCardTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#1f2937',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  folderCardHint: {
    fontSize: '11px',
    color: '#6b7280',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
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
  errorBanner: {
    marginTop: '8px',
    padding: '8px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '5px',
    fontSize: '12px',
    color: '#991b1b',
    fontWeight: 600,
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
  errorRow: { display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '8px' },
  errorMsg:   { margin: 0, color: '#d93025', fontSize: '13px', flex: 1 },
  retryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
    background: 'none',
    border: '1.5px solid #d93025',
    borderRadius: '6px',
    color: '#d93025',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 700,
    padding: '3px 8px',
    whiteSpace: 'nowrap' as const,
  },
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
  statusBar: {
    marginTop: '10px',
    padding: '10px 14px 12px',
    background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
    border: '1.5px solid #ddd6fe',
    borderRadius: '12px',
    transition: 'background 0.4s, border-color 0.4s',
  },
  statusBarDone: {
    background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
    border: '1.5px solid #6ee7b7',
  },
  statusTrack: {
    position: 'relative' as const,
    height: '24px',
    display: 'flex',
    alignItems: 'center',
  },
  statusTrackFill: {
    position: 'absolute' as const,
    left: 0,
    right: '22px',
    height: '5px',
    background: 'linear-gradient(90deg, #818cf8, #a78bfa, #c084fc)',
    borderRadius: '99px',
    animation: 'trackPulse 1.4s ease-in-out infinite',
  },
  statusTrackDone: {
    position: 'absolute' as const,
    left: 0,
    right: '22px',
    height: '5px',
    background: 'linear-gradient(90deg, #34d399, #10b981)',
    borderRadius: '99px',
  },
  hare: {
    position: 'absolute' as const,
    fontSize: '20px',
    lineHeight: 1,
    top: '50%',
    transform: 'translateY(-52%)',
    animation: 'hareRace 1.4s linear infinite',
    zIndex: 1,
    filter: 'drop-shadow(0 1px 2px rgba(99,102,241,0.3))',
  },
  hareDone: {
    position: 'absolute' as const,
    fontSize: '20px',
    lineHeight: 1,
    top: '50%',
    right: '24px',
    transform: 'translateY(-52%)',
    zIndex: 1,
    filter: 'drop-shadow(0 1px 3px rgba(16,185,129,0.4))',
  },
  finishFlag: {
    position: 'absolute' as const,
    right: 0,
    fontSize: '16px',
    lineHeight: 1,
  },
  statusLabel: {
    margin: '7px 0 0',
    fontSize: '11.5px',
    color: '#6d28d9',
    fontWeight: 600,
    textAlign: 'center' as const,
    letterSpacing: '0.1px',
  },
  statusLabelDone: {
    color: '#059669',
  },
  sectionHint: {
    margin: '3px 0 10px',
    fontSize: '11.5px',
    color: '#6b7280',
    lineHeight: 1.5,
  },
  fillBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
    padding: '11px 16px',
    fontSize: '14px',
    fontWeight: 700,
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(99,102,241,0.4)',
    letterSpacing: '0.2px',
  },
  tableWrap: {
    marginTop: '10px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  tableToggle: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: '#f9fafb',
    border: 'none',
    borderBottom: '1px solid #e5e7eb',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 700,
    color: '#374151',
    textAlign: 'left' as const,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '12px',
    tableLayout: 'fixed' as const,
  },
  th: {
    padding: '6px 8px',
    textAlign: 'left' as const,
    fontWeight: 700,
    fontSize: '10.5px',
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    position: 'sticky' as const,
    top: 0,
  },
  tr: {
    borderBottom: '1px solid #f3f4f6',
  },
  tdField: {
    padding: '7px 8px',
    color: '#374151',
    fontWeight: 600,
    maxWidth: '80px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  tdValue: {
    padding: '7px 8px',
    color: '#111827',
    fontWeight: 700,
    maxWidth: '90px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  tdAction: {
    padding: '7px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '2px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '13px',
    color: '#1f2937',
    fontWeight: 700,
  },
  copyBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3px',
    borderRadius: '4px',
    border: '1px solid #e5e7eb',
    background: '#f9fafb',
    color: '#6b7280',
    cursor: 'pointer',
  },
}
