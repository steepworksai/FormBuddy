import type { Manifest, DocumentIndex, ManifestEntry } from '../../types'

const INDEXING_DIR = '.indexing'
const MANIFEST_FILE = 'manifest.json'

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
  } catch {
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
  } catch {
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

export function buildManifestEntry(
  entry: DocumentIndex,
  checksum: string,
  sizeBytes: number,
  llmPrepared: boolean
): ManifestEntry {
  return {
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
}
