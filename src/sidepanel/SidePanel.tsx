import { useEffect, useRef, useState } from 'react'
import { requestFolderAccess, listFiles } from '../lib/folder/access'
import { indexDocument } from '../lib/indexing/indexer'
import { readManifest, writeManifest } from '../lib/indexing/manifest'
import { getTypeInfo } from '../lib/config/supportedTypes'
import { MAX_PDF_PAGES } from '../lib/parser/pdf'
import type { LLMConfig } from '../types'
import type { IndexPhase } from '../lib/indexing/indexer'

interface FileEntry {
  name: string
  size: number
  status: 'pending' | 'indexing' | 'indexed' | 'skipped' | 'too-large' | 'error'
  phase?: IndexPhase
  ocrProgress?: number
  error?: string
}

interface DetectedField {
  id: string
  label: string
  at: string
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

/** Mark every document in the manifest needsReindex so the LLM step re-runs. */
async function markAllForReindex(dirHandle: FileSystemDirectoryHandle): Promise<void> {
  const manifest = await readManifest(dirHandle)
  await writeManifest(dirHandle, {
    ...manifest,
    documents: manifest.documents.map(d => ({ ...d, needsReindex: true })),
  })
}

export default function SidePanel() {
  const [files, setFiles]         = useState<FileEntry[]>([])
  const [folderName, setFolderName] = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [busy, setBusy]           = useState(false)
  const [noLLM, setNoLLM]         = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const [detectedFields, setDetectedFields] = useState<DetectedField[]>([])

  // Persist between renders without triggering re-renders
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const rawFilesRef  = useRef<File[]>([])

  useEffect(() => {
    const onMessage = (
      message: unknown,
    ) => {
      const msg = message as {
        type?: string
        payload?: { fieldId?: string; fieldLabel?: string; detectedAt?: string }
      }

      if (msg.type !== 'FIELD_DETECTED' || !msg.payload?.fieldLabel) return

      const next: DetectedField = {
        id: msg.payload.fieldId ?? crypto.randomUUID(),
        label: msg.payload.fieldLabel,
        at: msg.payload.detectedAt ?? new Date().toISOString(),
      }

      setDetectedFields(prev => [next, ...prev].slice(0, 12))
    }

    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  function patchFile(name: string, patch: Partial<FileEntry>) {
    setFiles(prev => prev.map(f => f.name === name ? { ...f, ...patch } : f))
  }

  /** Core indexing loop — called by both the folder button and the refresh button. */
  async function runIndexing(rawFiles: File[], dirHandle: FileSystemDirectoryHandle, llmConfig: LLMConfig | undefined) {
    setFiles(rawFiles.map(f => ({ name: f.name, size: f.size, status: 'pending' })))

    for (const file of rawFiles) {
      patchFile(file.name, { status: 'indexing', phase: 'parsing' })
      try {
        const result = await indexDocument(
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
        const msg = err instanceof Error ? err.message : 'Unknown error'
        patchFile(file.name, { status: 'error', error: msg, phase: undefined })
      }
    }
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
      setError('Could not access folder. Please try again.')
    }
  }

  async function handleRefresh() {
    const dirHandle = dirHandleRef.current
    const rawFiles  = rawFilesRef.current

    if (!dirHandle || rawFiles.length === 0) {
      // No folder selected yet — just re-check the key status
      const llmConfig = await loadLLMConfig()
      setNoLLM(!llmConfig?.apiKey)
      return
    }

    setError(null)
    setRefreshed(false)
    setBusy(true)

    const llmConfig = await loadLLMConfig()
    setNoLLM(!llmConfig?.apiKey)

    // Force re-index so the LLM step runs on files that were indexed without a key
    await markAllForReindex(dirHandle)

    setBusy(false)
    await runIndexing(rawFiles, dirHandle, llmConfig)
    setRefreshed(true)
    setTimeout(() => setRefreshed(false), 3000)
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

  return (
    <div style={styles.container}>

      {/* Title bar */}
      <div style={styles.titleRow}>
        <h1 style={styles.title}>FormBuddy</h1>
        <div style={styles.iconRow}>
          {hasFolder && (
            <button
              style={styles.iconBtn}
              onClick={handleRefresh}
              disabled={busy}
              title="Refresh — re-read API key and re-index folder"
            >
              {busy ? '⏳' : refreshed ? '✓' : '🔄'}
            </button>
          )}
          <button style={styles.iconBtn} onClick={openSettings} title="Settings">⚙️</button>
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

      {/* Warnings / feedback */}
      {noLLM && (
        <div style={styles.warningBox}>
          <span>⚠️ No API key set — entities won't be extracted.</span>
          <button style={styles.inlineBtn} onClick={openSettings}>Configure →</button>
        </div>
      )}
      {refreshed && <p style={styles.successMsg}>✓ Refreshed with latest settings</p>}
      {error     && <p style={styles.errorMsg}>{error}</p>}

      {/* Folder label */}
      {folderName && <p style={styles.folderName}>📁 {folderName}</p>}

      {/* File list */}
      {files.length > 0 && (
        <ul style={styles.list}>
          {files.map(f => (
            <li key={f.name} style={styles.item}>
              <span>{getTypeInfo(f.name)?.icon ?? '📁'}</span>
              <span style={styles.fileName}>
                {f.name}
                <span style={styles.subtext}>{fileSubtext(f)}</span>
              </span>
              <span title={f.status}>{STATUS_ICON[f.status]}</span>
            </li>
          ))}
        </ul>
      )}

      {hasFolder && files.length === 0 && !busy && (
        <p style={styles.empty}>No supported files found in this folder.</p>
      )}

      <div style={styles.feedSection}>
        <h2 style={styles.feedTitle}>Detected Fields (Milestone 6)</h2>
        {detectedFields.length === 0 ? (
          <p style={styles.feedEmpty}>Focus any form field to see live detection.</p>
        ) : (
          <ul style={styles.feedList}>
            {detectedFields.map(item => (
              <li key={`${item.id}-${item.at}`} style={styles.feedItem}>
                Detected: {item.label}
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
  empty:      { marginTop: '12px', color: '#888', fontSize: '13px' },
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
  feedSection: {
    marginTop: '14px',
    borderTop: '1px solid #ececec',
    paddingTop: '10px',
  },
  feedTitle: {
    margin: 0,
    fontSize: '12px',
    color: '#444',
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
}
