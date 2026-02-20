import { describe, expect, it } from 'vitest'
import {
  buildManifestEntry,
  readManifest,
  readIndexEntry,
  writeIndexEntry,
  writeManifest,
  readFormKVCacheEntry,
  writeFormKVCacheEntry,
  clearFormKVCache,
} from '../../../src/lib/indexing/manifest'
import { createMemoryDirHandle } from '../../mocks/fsa'
import type { DocumentIndex, FormKVCacheFile } from '../../../src/types'

describe('TM2 manifest', () => {
  it('returns default manifest when no file exists', async () => {
    const dir = createMemoryDirHandle()
    const manifest = await readManifest(dir)

    expect(manifest.version).toBe('1.0')
    expect(Array.isArray(manifest.documents)).toBe(true)
    expect(manifest.documents.length).toBe(0)
  })

  it('writes and reads manifest roundtrip', async () => {
    const dir = createMemoryDirHandle()
    const now = new Date().toISOString()
    await writeManifest(dir, {
      version: '1.0',
      createdAt: now,
      lastUpdated: now,
      documents: [
        {
          id: 'doc-1',
          fileName: 'note.txt',
          type: 'text',
          indexFile: 'doc-1.json',
          checksum: 'sha256:abc',
          sizeBytes: 10,
          indexedAt: now,
          language: 'en',
          llmPrepared: false,
          needsReindex: false,
        },
      ],
    })

    const manifest = await readManifest(dir)
    expect(manifest.documents).toHaveLength(1)
    expect(manifest.documents[0].fileName).toBe('note.txt')
  })

  it('writes and reads index entries', async () => {
    const dir = createMemoryDirHandle()
    const entry: DocumentIndex = {
      id: 'doc-2',
      fileName: 'test.txt',
      type: 'text',
      indexedAt: new Date().toISOString(),
      language: 'en',
      pageCount: 1,
      pages: [{ page: 1, rawText: 'hello', fields: [] }],
      entities: {},
      summary: '',
      usedFields: [],
    }

    await writeIndexEntry(dir, 'doc-2.json', entry)
    const loaded = await readIndexEntry(dir, 'doc-2.json')
    expect(loaded?.fileName).toBe('test.txt')
  })

  it('returns null when index entry file does not exist', async () => {
    const dir = createMemoryDirHandle()
    const result = await readIndexEntry(dir, 'nonexistent.json')
    expect(result).toBeNull()
  })

  it('builds a manifest entry from indexed document metadata', () => {
    const now = new Date().toISOString()
    const entry: DocumentIndex = {
      id: 'doc-3',
      fileName: 'shot.png',
      type: 'screenshot',
      indexedAt: now,
      language: 'en',
      pageCount: 1,
      pages: [{ page: 1, rawText: 'abc', fields: [] }],
      entities: {},
      summary: '',
      usedFields: [],
    }
    const manifestEntry = buildManifestEntry(entry, 'sha256:test', 12, false)
    expect(manifestEntry.indexFile).toBe('doc-3.json')
    expect(manifestEntry.llmPrepared).toBe(false)
    expect(manifestEntry.needsReindex).toBe(false)
  })

  it('buildManifestEntry includes searchIndexFile when provided', () => {
    const now = new Date().toISOString()
    const entry: DocumentIndex = {
      id: 'doc-4',
      fileName: 'doc.pdf',
      type: 'pdf',
      indexedAt: now,
      language: 'en',
      pageCount: 1,
      pages: [],
      entities: {},
      summary: '',
      usedFields: [],
    }
    const manifestEntry = buildManifestEntry(entry, 'sha256:xyz', 500, true, 'doc-4.search.json')
    expect(manifestEntry.searchIndexFile).toBe('doc-4.search.json')
    expect(manifestEntry.llmPrepared).toBe(true)
  })
})

describe('FormKV cache operations', () => {
  const makeCache = (): FormKVCacheFile => ({
    version: '1.0',
    signature: 'sig-abc',
    generatedAt: new Date().toISOString(),
    mappings: [
      {
        fieldId: 'email',
        fieldLabel: 'Email Address',
        value: 'user@example.com',
        sourceFile: 'profile.pdf',
        reason: 'Found in profile.pdf',
        confidence: 'high',
      },
    ],
  })

  it('returns null when cache file does not exist', async () => {
    const dir = createMemoryDirHandle()
    const result = await readFormKVCacheEntry(dir, 'nonexistent-cache.json')
    expect(result).toBeNull()
  })

  it('writes and reads FormKV cache roundtrip', async () => {
    const dir = createMemoryDirHandle()
    const cache = makeCache()

    await writeFormKVCacheEntry(dir, 'cache-1.json', cache)
    const loaded = await readFormKVCacheEntry(dir, 'cache-1.json')

    expect(loaded?.version).toBe('1.0')
    expect(loaded?.signature).toBe('sig-abc')
    expect(loaded?.mappings.length).toBe(1)
    expect(loaded?.mappings[0].fieldLabel).toBe('Email Address')
    expect(loaded?.mappings[0].value).toBe('user@example.com')
  })

  it('overwrites existing cache file on write', async () => {
    const dir = createMemoryDirHandle()
    const cache1 = makeCache()
    const cache2 = { ...makeCache(), signature: 'sig-updated', mappings: [] }

    await writeFormKVCacheEntry(dir, 'cache-1.json', cache1)
    await writeFormKVCacheEntry(dir, 'cache-1.json', cache2)
    const loaded = await readFormKVCacheEntry(dir, 'cache-1.json')

    expect(loaded?.signature).toBe('sig-updated')
    expect(loaded?.mappings.length).toBe(0)
  })

  it('clearFormKVCache removes the form-kv directory and all contents', async () => {
    const dir = createMemoryDirHandle()
    const cache = makeCache()

    await writeFormKVCacheEntry(dir, 'cache-a.json', cache)
    await writeFormKVCacheEntry(dir, 'cache-b.json', cache)

    await clearFormKVCache(dir)

    const resultA = await readFormKVCacheEntry(dir, 'cache-a.json')
    const resultB = await readFormKVCacheEntry(dir, 'cache-b.json')
    expect(resultA).toBeNull()
    expect(resultB).toBeNull()
  })

  it('clearFormKVCache does not throw when directory does not exist', async () => {
    const dir = createMemoryDirHandle()
    await expect(clearFormKVCache(dir)).resolves.toBeUndefined()
  })
})
