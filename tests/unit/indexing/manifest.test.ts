import { describe, expect, it } from 'vitest'
import { buildManifestEntry, readManifest, readIndexEntry, writeIndexEntry, writeManifest } from '../../../src/lib/indexing/manifest'
import { createMemoryDirHandle } from '../../mocks/fsa'
import type { DocumentIndex } from '../../../src/types'

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
})
