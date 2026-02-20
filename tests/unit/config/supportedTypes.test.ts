import { describe, expect, it } from 'vitest'
import { getTypeInfo, isSupported, SUPPORTED_EXTENSIONS } from '../../../src/lib/config/supportedTypes'

describe('TM2 supported types', () => {
  it('recognizes supported file extensions', () => {
    expect(isSupported('passport.pdf')).toBe(true)
    expect(isSupported('photo.JPG')).toBe(true)
    expect(isSupported('note.txt')).toBe(true)
  })

  it('rejects unsupported file extensions', () => {
    expect(isSupported('sheet.xlsx')).toBe(false)
    expect(isSupported('archive.zip')).toBe(false)
  })

  it('returns metadata for a supported type', () => {
    expect(getTypeInfo('image.png')?.label).toBe('Image')
    expect(SUPPORTED_EXTENSIONS.has('pdf')).toBe(true)
  })
})
