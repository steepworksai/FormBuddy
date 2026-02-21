import type {
  Manifest,
  DocumentIndex,
  ManifestEntry,
  SearchIndexFile,
  FormKVCacheFile,
} from '../../types'

const INDEXING_DIR = 'FormBuddy'
const MANIFEST_FILE = 'manifest.json'
const FORM_KV_DIR = 'form-kv'

async function getIndexingDir(
  dirHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle> {
  return dirHandle.getDirectoryHandle(INDEXING_DIR, { create: true })
}

export async function readManifest(
  dirHandle: FileSystemDirectoryHandle
): Promise<Manifest> {
  try {
    const indexingDir = await getIndexingDir(dirHandle)
    const fileHandle = await indexingDir.getFileHandle(MANIFEST_FILE, { create: true })
    const file = await fileHandle.getFile()
    const text = await file.text()
    if (!text.trim()) throw new Error('empty')
    return JSON.parse(text) as Manifest
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg !== 'empty') {
      console.warn('[FormBuddy] readManifest error (returning empty):', msg)
    }
    return {
      version: '1.0',
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      documents: [],
    }
  }
}

export async function writeManifest(
  dirHandle: FileSystemDirectoryHandle,
  manifest: Manifest
): Promise<void> {
  const indexingDir = await getIndexingDir(dirHandle)
  const fileHandle = await indexingDir.getFileHandle(MANIFEST_FILE, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(manifest, null, 2))
  await writable.close()
}

export async function readIndexEntry(
  dirHandle: FileSystemDirectoryHandle,
  indexFile: string
): Promise<DocumentIndex | null> {
  try {
    const indexingDir = await getIndexingDir(dirHandle)
    const fileHandle = await indexingDir.getFileHandle(indexFile)
    const file = await fileHandle.getFile()
    return JSON.parse(await file.text()) as DocumentIndex
  } catch (err) {
    console.warn(`[FormBuddy] readIndexEntry failed for ${indexFile}:`, err instanceof Error ? err.message : String(err))
    return null
  }
}

export async function writeIndexEntry(
  dirHandle: FileSystemDirectoryHandle,
  indexFile: string,
  entry: DocumentIndex
): Promise<void> {
  const indexingDir = await getIndexingDir(dirHandle)
  const fileHandle = await indexingDir.getFileHandle(indexFile, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(entry, null, 2))
  await writable.close()
}

export async function readSearchIndexEntry(
  dirHandle: FileSystemDirectoryHandle,
  indexFile: string
): Promise<SearchIndexFile | null> {
  try {
    const indexingDir = await getIndexingDir(dirHandle)
    const fileHandle = await indexingDir.getFileHandle(indexFile)
    const file = await fileHandle.getFile()
    return JSON.parse(await file.text()) as SearchIndexFile
  } catch {
    return null
  }
}

export async function writeSearchIndexEntry(
  dirHandle: FileSystemDirectoryHandle,
  indexFile: string,
  entry: SearchIndexFile
): Promise<void> {
  const indexingDir = await getIndexingDir(dirHandle)
  const fileHandle = await indexingDir.getFileHandle(indexFile, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(entry, null, 2))
  await writable.close()
}

export async function readFormKVCacheEntry(
  dirHandle: FileSystemDirectoryHandle,
  cacheFile: string
): Promise<FormKVCacheFile | null> {
  try {
    const indexingDir = await getIndexingDir(dirHandle)
    const kvDir = await indexingDir.getDirectoryHandle(FORM_KV_DIR, { create: true })
    const fileHandle = await kvDir.getFileHandle(cacheFile)
    const file = await fileHandle.getFile()
    return JSON.parse(await file.text()) as FormKVCacheFile
  } catch {
    return null
  }
}

export async function writeFormKVCacheEntry(
  dirHandle: FileSystemDirectoryHandle,
  cacheFile: string,
  entry: FormKVCacheFile
): Promise<void> {
  const indexingDir = await getIndexingDir(dirHandle)
  const kvDir = await indexingDir.getDirectoryHandle(FORM_KV_DIR, { create: true })
  const fileHandle = await kvDir.getFileHandle(cacheFile, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(entry, null, 2))
  await writable.close()
}

export async function clearFormKVCache(
  dirHandle: FileSystemDirectoryHandle
): Promise<void> {
  try {
    const indexingDir = await getIndexingDir(dirHandle)
    await indexingDir.removeEntry(FORM_KV_DIR, { recursive: true })
  } catch {
    // Directory may not exist yet — nothing to clear
  }
}

export function buildManifestEntry(
  entry: DocumentIndex,
  checksum: string,
  sizeBytes: number,
  llmPrepared: boolean,
  searchIndexFile?: string
): ManifestEntry {
  const manifestEntry: ManifestEntry = {
    id: entry.id,
    fileName: entry.fileName,
    type: entry.type,
    indexFile: `${entry.id}.json`,
    checksum,
    sizeBytes,
    indexedAt: entry.indexedAt,
    language: entry.language,
    llmPrepared,
    needsReindex: false,
  }
  if (searchIndexFile) manifestEntry.searchIndexFile = searchIndexFile
  return manifestEntry
}
