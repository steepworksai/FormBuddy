import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDirHandle } from '../../mocks/fsa'

vi.mock('../../../src/lib/parser/pdf', () => ({
  extractTextFromPDF: vi.fn(async () => ({
    pages: [{ page: 1, rawText: 'pdf text' }],
    pageCount: 1,
  })),
  PDFTooLargeError: class extends Error {
    pageCount: number
    constructor(pageCount: number) {
      super('too large')
      this.pageCount = pageCount
    }
  },
}))

vi.mock('../../../src/lib/parser/ocr', () => ({
  extractTextFromImage: vi.fn(async () => ({
    pages: [{ page: 1, rawText: 'image text', fields: [] }],
    pageCount: 1,
  })),
  ocrCanvases: vi.fn(async () => new Map<number, string>()),
}))

vi.mock('../../../src/lib/llm/extractor', () => ({
  extractEntitiesWithLLM: vi.fn(async () => ({
    entities: { identifiers: ['ABC-123'] },
    summary: 'mock summary',
  })),
}))

describe('TM2 indexer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks screenshot files with screenshot type', async () => {
    const { indexDocument } = await import('../../../src/lib/indexing/indexer')
    const dir = createMemoryDirHandle()
    const file = new File(['img-data'], 'screenshot-2026-01-01-1111.png', { type: 'image/png' })

    const result = await indexDocument(file, dir)
    expect(result.status).toBe('indexed')
    if (result.status === 'indexed') {
      expect(result.entry.type).toBe('screenshot')
    }
  })

  it('skips unchanged files on reindex', async () => {
    const { indexDocument } = await import('../../../src/lib/indexing/indexer')
    const dir = createMemoryDirHandle()
    const file = new File(['same-data'], 'profile.txt', { type: 'text/plain' })

    const first = await indexDocument(file, dir)
    expect(first.status).toBe('indexed')

    const second = await indexDocument(file, dir)
    expect(second.status).toBe('skipped')
  })
})
