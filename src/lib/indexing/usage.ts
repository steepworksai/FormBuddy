import type { Suggestion, UsedField } from '../../types'
import { readIndexEntry, readManifest, writeIndexEntry } from './manifest'

const INDEXING_DIR = '.indexing'
const USAGE_FILE = 'usage.json'

export interface UsageSession {
  sessionId: string
  domain: string
  startedAt: string
  endedAt?: string
  usedSuggestions: Array<{
    fieldId: string
    fieldLabel: string
    value: string
    sourceFile: string
    sourcePage?: number
    sourceText: string
    reason: string
    confidence: 'high' | 'medium' | 'low'
    usedAt: string
  }>
}

export interface UsageLog {
  sessions: UsageSession[]
}

async function readUsageLog(dirHandle: FileSystemDirectoryHandle): Promise<UsageLog> {
  try {
    const indexingDir = await dirHandle.getDirectoryHandle(INDEXING_DIR, { create: true })
    const usageHandle = await indexingDir.getFileHandle(USAGE_FILE, { create: true })
    const usageFile = await usageHandle.getFile()
    const text = await usageFile.text()
    if (!text.trim()) return { sessions: [] }
    return JSON.parse(text) as UsageLog
  } catch {
    return { sessions: [] }
  }
}

async function writeUsageLog(dirHandle: FileSystemDirectoryHandle, usage: UsageLog): Promise<void> {
  const indexingDir = await dirHandle.getDirectoryHandle(INDEXING_DIR, { create: true })
  const usageHandle = await indexingDir.getFileHandle(USAGE_FILE, { create: true })
  const writable = await usageHandle.createWritable()
  await writable.write(JSON.stringify(usage, null, 2))
  await writable.close()
}

export async function appendUsage(
  dirHandle: FileSystemDirectoryHandle,
  suggestion: Suggestion,
  domain: string,
  usedAtIso: string
): Promise<void> {
  const usage = await readUsageLog(dirHandle)

  let session = usage.sessions.find(s => s.sessionId === suggestion.sessionId)
  if (!session) {
    session = {
      sessionId: suggestion.sessionId,
      domain,
      startedAt: usedAtIso,
      usedSuggestions: [],
    }
    usage.sessions.push(session)
  }

  session.usedSuggestions.push({
    fieldId: suggestion.fieldId,
    fieldLabel: suggestion.fieldLabel,
    value: suggestion.value,
    sourceFile: suggestion.sourceFile,
    sourcePage: suggestion.sourcePage,
    sourceText: suggestion.sourceText,
    reason: suggestion.reason,
    confidence: suggestion.confidence,
    usedAt: usedAtIso,
  })
  session.endedAt = usedAtIso

  await writeUsageLog(dirHandle, usage)
}

export async function markUsedFieldInDocument(
  dirHandle: FileSystemDirectoryHandle,
  suggestion: Suggestion,
  domain: string,
  usedAtIso: string
): Promise<void> {
  const targetDoc = suggestion.sourceFile
  if (!targetDoc) return

  const manifest = await readManifest(dirHandle)
  const entry = manifest.documents.find(d => d.fileName === targetDoc)
  if (!entry) return

  const index = await readIndexEntry(dirHandle, entry.indexFile)
  if (!index) return

  const usedField: UsedField = {
    fieldLabel: suggestion.fieldLabel,
    value: suggestion.value,
    usedOn: domain,
    usedAt: usedAtIso,
    sessionId: suggestion.sessionId,
  }

  index.usedFields.push(usedField)
  await writeIndexEntry(dirHandle, entry.indexFile, index)
}
