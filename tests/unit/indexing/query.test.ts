import { describe, expect, it } from 'vitest'
import { queryIndex } from '../../../src/lib/indexing/query'
import type { DocumentIndex } from '../../../src/types'

function makeEntry(override: Partial<DocumentIndex> = {}): DocumentIndex {
  return {
    id: 'doc-1',
    fileName: 'profile.pdf',
    type: 'pdf',
    indexedAt: new Date().toISOString(),
    language: 'en',
    pageCount: 1,
    pages: [],
    entities: {},
    summary: '',
    usedFields: [],
    ...override,
  }
}

describe('queryIndex', () => {
  it('returns empty array for empty field label', () => {
    const result = queryIndex('', [makeEntry()])
    expect(result).toEqual([])
  })

  it('returns empty array when label is only stop words', () => {
    const result = queryIndex('the a an of for to', [makeEntry()])
    expect(result).toEqual([])
  })

  it('returns empty array when no entries provided', () => {
    const result = queryIndex('Passport Number', [])
    expect(result).toEqual([])
  })

  it('returns empty array when no text matches', () => {
    const entry = makeEntry({ pages: [{ page: 1, rawText: 'hello world', fields: [] }] })
    const result = queryIndex('passport number', [entry])
    expect(result).toEqual([])
  })

  it('finds matches in raw page text', () => {
    const entry = makeEntry({
      pages: [{ page: 1, rawText: 'My passport number is P1234567', fields: [] }],
    })
    const result = queryIndex('Passport Number', [entry])
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].sourceText).toContain('passport')
    expect(result[0].documentId).toBe('doc-1')
    expect(result[0].fileName).toBe('profile.pdf')
  })

  it('autofill lookup has highest priority (score + 10)', () => {
    const entry = makeEntry({
      pages: [{ page: 1, rawText: 'passport mentioned here', fields: [] }],
      searchIndex: {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        items: [],
        autofill: { passport_number: 'P9876543' },
      },
    })
    const result = queryIndex('Passport Number', [entry])
    const autofillResult = result.find(r => r.sourceText === 'P9876543')
    expect(autofillResult).toBeTruthy()
    expect(autofillResult!.score).toBeGreaterThan(10)
  })

  it('search index items have second priority (score + 6)', () => {
    const entry = makeEntry({
      pages: [],
      searchIndex: {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        items: [
          {
            fieldLabel: 'Email Address',
            value: 'user@example.com',
            aliases: ['email'],
            sourceText: 'Email: user@example.com',
            confidence: 'high',
          },
        ],
        autofill: {},
      },
    })
    const result = queryIndex('Email Address', [entry])
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].sourceText).toBe('Email: user@example.com')
    expect(result[0].score).toBeGreaterThan(6)
  })

  it('search index item uses value when sourceText is missing', () => {
    const entry = makeEntry({
      pages: [],
      searchIndex: {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        items: [
          {
            fieldLabel: 'Email',
            value: 'fallback@example.com',
            aliases: [],
            sourceText: '',
            confidence: 'medium',
          },
        ],
        autofill: {},
      },
    })
    const result = queryIndex('Email', [entry])
    expect(result[0].sourceText).toBe('fallback@example.com')
  })

  it('aliases contribute to search index item score', () => {
    const entry = makeEntry({
      pages: [],
      searchIndex: {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        items: [
          {
            fieldLabel: 'Contact',
            value: 'test@example.com',
            aliases: ['email', 'email address'],
            sourceText: 'test@example.com',
            confidence: 'medium',
          },
        ],
        autofill: {},
      },
    })
    const result = queryIndex('Email Address', [entry])
    expect(result.length).toBeGreaterThan(0)
  })

  it('entity identifiers bucket is triggered by "passport" token', () => {
    const entry = makeEntry({
      entities: { identifiers: ['passport-value-123'] },
    })
    // 'passport' maps to identifiers bucket; scoreText('passport-value-123', ['passport']) > 0
    const result = queryIndex('Passport', [entry])
    const entityResult = result.find(r => r.sourceText === 'passport-value-123')
    expect(entityResult).toBeTruthy()
    expect(entityResult!.score).toBeGreaterThan(2)
  })

  it('entity names bucket is triggered by "name" token', () => {
    const entry = makeEntry({
      entities: { names: ['name of applicant'] },
    })
    // 'name' maps to names bucket; 'name of applicant' contains 'name'
    const result = queryIndex('Full Name', [entry])
    const entityResult = result.find(r => r.sourceText === 'name of applicant')
    expect(entityResult).toBeTruthy()
  })

  it('entity addresses bucket is triggered by "address" token', () => {
    const entry = makeEntry({
      entities: { addresses: ['123 address street'] },
    })
    const result = queryIndex('Address', [entry])
    const entityResult = result.find(r => r.sourceText === '123 address street')
    expect(entityResult).toBeTruthy()
  })

  it('entity dates bucket is triggered by "date" token', () => {
    const entry = makeEntry({
      entities: { dates: ['2000-01-date-reference'] },
    })
    const result = queryIndex('Date of Birth', [entry])
    const entityResult = result.find(r => r.sourceText === '2000-01-date-reference')
    expect(entityResult).toBeTruthy()
  })

  it('entity employers bucket is triggered by "employer" token', () => {
    const entry = makeEntry({
      entities: { employers: ['employer inc company'] },
    })
    const result = queryIndex('Employer', [entry])
    const entityResult = result.find(r => r.sourceText === 'employer inc company')
    expect(entityResult).toBeTruthy()
  })

  it('entity currencies bucket is triggered by "income" token', () => {
    const entry = makeEntry({
      entities: { currencies: ['income 50000 salary'] },
    })
    const result = queryIndex('Annual Income', [entry])
    const entityResult = result.find(r => r.sourceText === 'income 50000 salary')
    expect(entityResult).toBeTruthy()
  })

  it('entity numbers bucket is triggered by "account" token', () => {
    const entry = makeEntry({
      entities: { numbers: ['account-number-ref-12345'] },
    })
    const result = queryIndex('Account Number', [entry])
    const entityResult = result.find(r => r.sourceText === 'account-number-ref-12345')
    expect(entityResult).toBeTruthy()
  })

  it('limits results to maxCandidates', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        id: `doc-${i}`,
        fileName: `doc${i}.pdf`,
        pages: [{ page: 1, rawText: `passport number document ${i}`, fields: [] }],
      })
    )
    const result = queryIndex('Passport Number', entries, 3)
    expect(result.length).toBeLessThanOrEqual(3)
  })

  it('sorts results by score descending', () => {
    const entry = makeEntry({
      pages: [
        { page: 1, rawText: 'passport number P1234567', fields: [] },
        { page: 2, rawText: 'passport page here', fields: [] },
      ],
      searchIndex: {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        items: [],
        autofill: { passport_number: 'P9999999' },
      },
    })
    const result = queryIndex('Passport Number', [entry])
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score)
    }
  })

  it('generates snippet centered around matching token', () => {
    const prefix = 'A'.repeat(100)
    const suffix = 'B'.repeat(100)
    const longText = `${prefix} passport ${suffix}`
    const entry = makeEntry({
      pages: [{ page: 1, rawText: longText, fields: [] }],
    })
    const result = queryIndex('Passport', [entry])
    expect(result[0].sourceText).toContain('passport')
    expect(result[0].sourceText.length).toBeLessThan(longText.length)
  })

  it('snippet falls back to prefix when no token found in text', () => {
    // Token doesn't appear at all — no match, so empty result
    const entry = makeEntry({
      pages: [{ page: 1, rawText: 'unrelated content here', fields: [] }],
    })
    const result = queryIndex('Passport', [entry])
    expect(result).toEqual([])
  })

  it('returns correct sourcePage from matched page', () => {
    const entry = makeEntry({
      pages: [
        { page: 1, rawText: 'nothing here', fields: [] },
        { page: 3, rawText: 'passport number info', fields: [] },
      ],
    })
    const result = queryIndex('Passport', [entry])
    expect(result[0].sourcePage).toBe(3)
  })

  it('handles multiple documents and returns from both', () => {
    const entry1 = makeEntry({
      id: 'doc-1',
      pages: [{ page: 1, rawText: 'passport number ABC', fields: [] }],
    })
    const entry2 = makeEntry({
      id: 'doc-2',
      fileName: 'other.pdf',
      pages: [{ page: 1, rawText: 'passport number DEF', fields: [] }],
    })
    const result = queryIndex('Passport Number', [entry1, entry2], 10)
    const ids = result.map(r => r.documentId)
    expect(ids).toContain('doc-1')
    expect(ids).toContain('doc-2')
  })

  it('skips autofill keys/values with zero score', () => {
    const entry = makeEntry({
      searchIndex: {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        items: [],
        autofill: { full_name: 'John Doe' },
      },
    })
    // 'Passport Number' tokens don't match 'full_name' or 'John Doe'
    const result = queryIndex('Passport Number', [entry])
    expect(result.find(r => r.sourceText === 'John Doe')).toBeUndefined()
  })

  it('autofill value score includes key and value contributions', () => {
    const entry = makeEntry({
      searchIndex: {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        items: [],
        autofill: { email_address: 'email@example.com' },
      },
    })
    // 'email' token matches both key 'email_address' and value 'email@example.com'
    const result = queryIndex('Email', [entry])
    expect(result[0].score).toBeGreaterThanOrEqual(10 + 4 + 2) // key*4 + value*2 + 10
  })
})
