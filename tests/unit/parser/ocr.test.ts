import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../../src/lib/llm/vision', () => ({
  extractTextWithVision: vi.fn(),
  canvasToBase64: vi.fn(),
  fileToBase64: vi.fn(),
}))

import { extractTextWithVision, canvasToBase64, fileToBase64 } from '../../../src/lib/llm/vision'
import { extractTextFromImage, ocrCanvases } from '../../../src/lib/parser/ocr'
import type { LLMConfig } from '../../../src/types'

const mockExtractTextWithVision = extractTextWithVision as ReturnType<typeof vi.fn>
const mockCanvasToBase64 = canvasToBase64 as ReturnType<typeof vi.fn>
const mockFileToBase64 = fileToBase64 as ReturnType<typeof vi.fn>

const anthropicConfig: LLMConfig = {
  provider: 'anthropic',
  apiKey: 'test-anthropic-key',
  model: 'claude-sonnet-4-6',
}

const openaiConfig: LLMConfig = {
  provider: 'openai',
  apiKey: 'test-openai-key',
  model: 'gpt-4o',
}

function makeFile(name = 'photo.png', type = 'image/png'): File {
  return new File(['fake-image-data'], name, { type })
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 100
  canvas.height = 100
  return canvas
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extractTextFromImage', () => {
  it('throws when no llmConfig is provided', async () => {
    await expect(extractTextFromImage(makeFile())).rejects.toThrow(
      'An Anthropic API key is required'
    )
  })

  it('throws when provider is not anthropic', async () => {
    await expect(extractTextFromImage(makeFile(), undefined, openaiConfig)).rejects.toThrow(
      'An Anthropic API key is required'
    )
  })

  it('throws when apiKey is empty', async () => {
    await expect(extractTextFromImage(makeFile(), undefined, {
      provider: 'anthropic',
      apiKey: '',
      model: 'claude-sonnet-4-6',
    })).rejects.toThrow('An Anthropic API key is required')
  })

  it('includes file name in error message', async () => {
    await expect(extractTextFromImage(makeFile('myimage.jpg'))).rejects.toThrow('myimage.jpg')
  })

  it('calls vision and returns pages', async () => {
    mockFileToBase64.mockResolvedValueOnce({ base64: 'abc123', mediaType: 'image/png' })
    mockExtractTextWithVision.mockResolvedValueOnce('First Name: John\nLast Name: Doe')

    const result = await extractTextFromImage(makeFile(), undefined, anthropicConfig)

    expect(result.pageCount).toBe(1)
    expect(result.pages.length).toBe(1)
    expect(result.pages[0].page).toBe(1)
    expect(result.pages[0].rawText).toContain('First Name: John')
    expect(result.pages[0].fields).toEqual([])
  })

  it('normalizes OCR text (collapses whitespace, removes blank lines)', async () => {
    mockFileToBase64.mockResolvedValueOnce({ base64: 'abc', mediaType: 'image/png' })
    mockExtractTextWithVision.mockResolvedValueOnce(
      'Line 1   \r\n\u00a0\nLine  2\n\n\nLine 3'
    )

    const result = await extractTextFromImage(makeFile(), undefined, anthropicConfig)
    const text = result.pages[0].rawText
    expect(text).toBe('Line 1\nLine 2\nLine 3')
  })

  it('calls onProgress with 20 and 100', async () => {
    mockFileToBase64.mockResolvedValueOnce({ base64: 'abc', mediaType: 'image/png' })
    mockExtractTextWithVision.mockResolvedValueOnce('text')

    const progressCalls: number[] = []
    await extractTextFromImage(makeFile(), (pct) => progressCalls.push(pct), anthropicConfig)

    expect(progressCalls).toContain(20)
    expect(progressCalls).toContain(100)
  })

  it('wraps vision errors with file name', async () => {
    mockFileToBase64.mockResolvedValueOnce({ base64: 'abc', mediaType: 'image/png' })
    mockExtractTextWithVision.mockRejectedValueOnce(new Error('API timeout'))

    await expect(
      extractTextFromImage(makeFile('scan.png'), undefined, anthropicConfig)
    ).rejects.toThrow('Vision OCR failed for scan.png: API timeout')
  })
})

describe('ocrCanvases', () => {
  it('throws when no llmConfig provided', async () => {
    await expect(ocrCanvases([{ pageNum: 1, canvas: makeCanvas() }])).rejects.toThrow(
      'An Anthropic API key is required'
    )
  })

  it('throws when provider is not anthropic', async () => {
    await expect(
      ocrCanvases([{ pageNum: 1, canvas: makeCanvas() }], undefined, openaiConfig)
    ).rejects.toThrow('An Anthropic API key is required')
  })

  it('returns empty Map for empty canvases array', async () => {
    const result = await ocrCanvases([], undefined, anthropicConfig)
    expect(result.size).toBe(0)
  })

  it('processes multiple canvases and returns Map by pageNum', async () => {
    mockCanvasToBase64
      .mockReturnValueOnce({ base64: 'page1b64', mediaType: 'image/png' })
      .mockReturnValueOnce({ base64: 'page2b64', mediaType: 'image/png' })
    mockExtractTextWithVision
      .mockResolvedValueOnce('Page 1 content')
      .mockResolvedValueOnce('Page 2 content')

    const canvases = [
      { pageNum: 1, canvas: makeCanvas() },
      { pageNum: 3, canvas: makeCanvas() },
    ]
    const result = await ocrCanvases(canvases, undefined, anthropicConfig)

    expect(result.size).toBe(2)
    expect(result.get(1)).toBe('Page 1 content')
    expect(result.get(3)).toBe('Page 2 content')
  })

  it('normalizes OCR text for each canvas', async () => {
    mockCanvasToBase64.mockReturnValueOnce({ base64: 'abc', mediaType: 'image/png' })
    mockExtractTextWithVision.mockResolvedValueOnce('  Line 1  \r\n\u00a0\n  Line 2  ')

    const result = await ocrCanvases([{ pageNum: 2, canvas: makeCanvas() }], undefined, anthropicConfig)
    expect(result.get(2)).toBe('Line 1\nLine 2')
  })

  it('calls onProgress at incremental percentages', async () => {
    mockCanvasToBase64
      .mockReturnValueOnce({ base64: 'a', mediaType: 'image/png' })
      .mockReturnValueOnce({ base64: 'b', mediaType: 'image/png' })
    mockExtractTextWithVision
      .mockResolvedValueOnce('text1')
      .mockResolvedValueOnce('text2')

    const progressCalls: number[] = []
    await ocrCanvases(
      [{ pageNum: 1, canvas: makeCanvas() }, { pageNum: 2, canvas: makeCanvas() }],
      (pct) => progressCalls.push(pct),
      anthropicConfig
    )

    expect(progressCalls).toContain(50)
    expect(progressCalls).toContain(100)
  })

  it('wraps canvas errors with page number', async () => {
    mockCanvasToBase64.mockReturnValueOnce({ base64: 'abc', mediaType: 'image/png' })
    mockExtractTextWithVision.mockRejectedValueOnce(new Error('Vision error'))

    await expect(
      ocrCanvases([{ pageNum: 5, canvas: makeCanvas() }], undefined, anthropicConfig)
    ).rejects.toThrow('Vision OCR failed on page 5: Vision error')
  })

  it('handles non-Error thrown objects in error message', async () => {
    mockCanvasToBase64.mockReturnValueOnce({ base64: 'abc', mediaType: 'image/png' })
    mockExtractTextWithVision.mockRejectedValueOnce('string error')

    await expect(
      ocrCanvases([{ pageNum: 1, canvas: makeCanvas() }], undefined, anthropicConfig)
    ).rejects.toThrow('string error')
  })
})
