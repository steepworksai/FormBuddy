import { describe, expect, it } from 'vitest'
import { computeChecksum } from '../../../src/lib/indexing/checksum'

describe('TM2 checksum', () => {
  it('produces deterministic sha256 checksum with prefix', async () => {
    const file = new File(['hello-world'], 'hello.txt', { type: 'text/plain' })
    const first = await computeChecksum(file)
    const second = await computeChecksum(file)

    expect(first).toBe(second)
    expect(first.startsWith('sha256:')).toBe(true)
    expect(first.length).toBeGreaterThan(16)
  })
})
