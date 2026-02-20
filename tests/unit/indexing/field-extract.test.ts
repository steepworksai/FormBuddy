import { describe, expect, it } from 'vitest'
import { extractFieldsFromRawText } from '../../../src/lib/indexing/fieldExtract'

describe('field extraction heuristic', () => {
  it('extracts clean label-value pairs from colon lines', () => {
    const fields = extractFieldsFromRawText(
      [
        'Full Name: Venkatesh Poosarla',
        'Email Address: venkatesh.poosarla@example.com',
        'Passport Number: P9384721',
      ].join('\n')
    )

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Email Address', value: 'venkatesh.poosarla@example.com' }),
        expect.objectContaining({ label: 'Passport Number', value: 'P9384721' }),
      ])
    )
  })

  it('skips lines without a field-like key', () => {
    const fields = extractFieldsFromRawText(
      [
        'Use this document as indexed context for FormBuddy suggestion tests.',
        'Tip: Focus form fields with matching labels.',
      ].join('\n')
    )

    expect(fields).toEqual([
      expect.objectContaining({ label: 'Tip', value: 'Focus form fields with matching labels.' }),
    ])
  })
})
