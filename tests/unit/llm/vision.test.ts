import { describe, expect, it } from 'vitest'

import { fileToBase64 } from '../../../src/lib/llm/vision'

function makeFile(name: string, type: string): File {
  // Minimal bytes; we're validating media type inference, not OCR quality.
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

describe('vision fileToBase64', () => {
  it('infers image/png from filename when file.type is empty', async () => {
    const file = makeFile('scan.png', '')
    const { mediaType, base64 } = await fileToBase64(file)
    expect(mediaType).toBe('image/png')
    expect(base64.length).toBeGreaterThan(0)
  })

  it('infers image/webp from filename when file.type is unknown', async () => {
    const file = makeFile('scan.webp', 'application/octet-stream')
    const { mediaType } = await fileToBase64(file)
    expect(mediaType).toBe('image/webp')
  })

  it('respects supported file.type when present', async () => {
    const file = makeFile('whatever.bin', 'image/png')
    const { mediaType } = await fileToBase64(file)
    expect(mediaType).toBe('image/png')
  })
})

