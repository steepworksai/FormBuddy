import { describe, expect, it } from 'vitest'
import { buildLocalSearchIndex, mergeSearchIndexes } from '../../../src/lib/indexing/autofill'
import type { FieldEntry } from '../../../src/types'

function makeField(label: string, value: string): FieldEntry {
  return { label, value, confidence: 'high', boundingContext: `${label}: ${value}` }
}

describe('local autofill index', () => {
  it('builds canonical autofill keys from parsed fields', () => {
    const index = buildLocalSearchIndex({
      pages: [
        {
          page: 1,
          rawText: '',
          fields: [
            { label: 'Full Name', value: 'Akhila Rao', confidence: 'high', boundingContext: 'Full Name: Akhila Rao' },
            { label: 'Email Address', value: 'akhila@example.com', confidence: 'high', boundingContext: 'Email: akhila@example.com' },
            { label: 'Issue Date', value: '2024-01-10', confidence: 'high', boundingContext: 'Issue Date: 2024-01-10' },
          ],
        },
      ],
      entities: {},
    })

    expect(index.autofill?.full_name).toBe('Akhila Rao')
    expect(index.autofill?.first_name).toBe('Akhila')
    expect(index.autofill?.last_name).toBe('Rao')
    expect(index.autofill?.email_address).toBe('akhila@example.com')
    expect(index.autofill?.issue_date).toBe('2024-01-10')
    expect(index.items.length).toBeGreaterThan(0)
  })

  it('maps driver license label to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Driver License Number', 'DL-12345')] }],
      entities: {},
    })
    expect(index.autofill?.driver_license_number).toBe('DL-12345')
  })

  it('maps passport label to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Passport Number', 'P9876543')] }],
      entities: {},
    })
    expect(index.autofill?.passport_number).toBe('P9876543')
  })

  it('maps phone number label to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Phone Number', '555-1234')] }],
      entities: {},
    })
    expect(index.autofill?.phone_number).toBe('555-1234')
  })

  it('maps date of birth label to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Date of Birth', '1990-05-20')] }],
      entities: {},
    })
    expect(index.autofill?.date_of_birth).toBe('1990-05-20')
  })

  it('maps DOB abbreviation to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('DOB', '1985-03-15')] }],
      entities: {},
    })
    expect(index.autofill?.date_of_birth).toBe('1985-03-15')
  })

  it('maps city, state, zip labels to canonical keys', () => {
    const index = buildLocalSearchIndex({
      pages: [
        {
          page: 1,
          rawText: '',
          fields: [
            makeField('City', 'Springfield'),
            makeField('State', 'IL'),
            makeField('Zip Code', '62701'),
          ],
        },
      ],
      entities: {},
    })
    expect(index.autofill?.city).toBe('Springfield')
    expect(index.autofill?.state).toBe('IL')
    expect(index.autofill?.zip_code).toBe('62701')
  })

  it('maps sex/gender label to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Sex', 'M')] }],
      entities: {},
    })
    expect(index.autofill?.sex).toBe('M')
  })

  it('maps height label to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Height', '5\'10"')] }],
      entities: {},
    })
    expect(index.autofill?.height).toBe('5\'10"')
  })

  it('maps eye color label to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Eye Color', 'Brown')] }],
      entities: {},
    })
    expect(index.autofill?.eye_color).toBe('Brown')
  })

  it('maps hair color label to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Hair Color', 'Black')] }],
      entities: {},
    })
    expect(index.autofill?.hair_color).toBe('Black')
  })

  it('maps loyalty number label to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Loyalty Number', 'LY-99999')] }],
      entities: {},
    })
    expect(index.autofill?.loyalty_number).toBe('LY-99999')
  })

  it('maps address line 2 label to canonical key', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Apt / Unit', '4B')] }],
      entities: {},
    })
    expect(index.autofill?.address_line_2).toBe('4B')
  })

  it('does not add autofill value exceeding 240 characters', () => {
    const longValue = 'x'.repeat(241)
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Email Address', longValue)] }],
      entities: {},
    })
    expect(index.autofill?.email_address).toBeUndefined()
  })

  it('deduplicates items with same fieldLabel+value', () => {
    const index = buildLocalSearchIndex({
      pages: [
        {
          page: 1,
          rawText: '',
          fields: [
            makeField('Email Address', 'user@example.com'),
            makeField('Email Address', 'user@example.com'),
          ],
        },
      ],
      entities: {},
    })
    const emailItems = index.items.filter(i => i.fieldLabel === 'Email Address')
    expect(emailItems.length).toBe(1)
  })

  it('builds autofill from entities.names when no name field exists', () => {
    const index = buildLocalSearchIndex({
      pages: [],
      entities: { names: ['Alice Smith'] },
    })
    expect(index.autofill?.full_name).toBe('Alice Smith')
    expect(index.autofill?.first_name).toBe('Alice')
    expect(index.autofill?.last_name).toBe('Smith')
  })

  it('splits 3-part name into first, middle, last', () => {
    const index = buildLocalSearchIndex({
      pages: [],
      entities: { names: ['John Michael Doe'] },
    })
    expect(index.autofill?.first_name).toBe('John')
    expect(index.autofill?.middle_name).toBe('Michael')
    expect(index.autofill?.last_name).toBe('Doe')
  })

  it('does not split single-word name', () => {
    const index = buildLocalSearchIndex({
      pages: [],
      entities: { names: ['Cher'] },
    })
    // Single word — splitName returns {} so no first/last added
    expect(index.autofill?.first_name).toBeUndefined()
    expect(index.autofill?.last_name).toBeUndefined()
  })

  it('builds autofill from entity first_names and last_names', () => {
    const index = buildLocalSearchIndex({
      pages: [],
      entities: { first_names: ['Bob'], last_names: ['Jones'] },
    })
    expect(index.autofill?.first_name).toBe('Bob')
    expect(index.autofill?.last_name).toBe('Jones')
  })

  it('builds autofill from entity emails and phones', () => {
    const index = buildLocalSearchIndex({
      pages: [],
      entities: { emails: ['test@example.com'], phone_numbers: ['555-9999'] },
    })
    expect(index.autofill?.email_address).toBe('test@example.com')
    expect(index.autofill?.phone_number).toBe('555-9999')
  })

  it('builds autofill from entity addresses', () => {
    const index = buildLocalSearchIndex({
      pages: [],
      entities: { addresses: ['123 Main Street'] },
    })
    expect(index.autofill?.address).toBe('123 Main Street')
  })

  it('builds autofill from entity dates when no date_of_birth field', () => {
    const index = buildLocalSearchIndex({
      pages: [],
      entities: { dates: ['1990-01-01'] },
    })
    expect(index.autofill?.date_of_birth).toBe('1990-01-01')
  })

  it('does not overwrite date_of_birth from entities if already set by field', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Date of Birth', '1985-06-15')] }],
      entities: { dates: ['2000-01-01'] },
    })
    expect(index.autofill?.date_of_birth).toBe('1985-06-15')
  })

  it('adds identifier from entities when no passport or license field set', () => {
    const index = buildLocalSearchIndex({
      pages: [],
      entities: { identifiers: ['ID-99999'] },
    })
    expect(index.autofill?.identifier).toBe('ID-99999')
  })

  it('does not overwrite passport_number with entity identifier', () => {
    const index = buildLocalSearchIndex({
      pages: [{ page: 1, rawText: '', fields: [makeField('Passport Number', 'P1234')] }],
      entities: { identifiers: ['ID-99999'] },
    })
    expect(index.autofill?.passport_number).toBe('P1234')
    expect(index.autofill?.identifier).toBeUndefined()
  })

  it('merges local and llm indexes with llm override', () => {
    const merged = mergeSearchIndexes(
      {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        items: [
          { fieldLabel: 'Email Address', value: 'local@example.com', aliases: [], sourceText: 'local', confidence: 'medium' },
        ],
        autofill: { email_address: 'local@example.com', full_name: 'Local User' },
      },
      {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        items: [
          { fieldLabel: 'Email Address', value: 'llm@example.com', aliases: ['email'], sourceText: 'llm', confidence: 'high' },
        ],
        autofill: { email_address: 'llm@example.com' },
      }
    )

    expect(merged.autofill?.email_address).toBe('llm@example.com')
    expect(merged.autofill?.full_name).toBe('Local User')
    expect(merged.items.some(item => item.value === 'llm@example.com')).toBe(true)
  })

  it('mergeSearchIndexes returns base when override is undefined', () => {
    const base = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      items: [{ fieldLabel: 'Name', value: 'Alice', aliases: [], sourceText: 'Name: Alice', confidence: 'high' as const }],
      autofill: { full_name: 'Alice' },
    }
    const merged = mergeSearchIndexes(base)
    expect(merged).toBe(base)
  })

  it('mergeSearchIndexes deduplicates items by fieldLabel+value', () => {
    const base = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      items: [{ fieldLabel: 'Email', value: 'user@example.com', aliases: [], sourceText: '', confidence: 'medium' as const }],
      autofill: {},
    }
    const override = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      items: [{ fieldLabel: 'Email', value: 'user@example.com', aliases: ['email'], sourceText: 'llm', confidence: 'high' as const }],
      autofill: {},
    }
    const merged = mergeSearchIndexes(base, override)
    const emailItems = merged.items.filter(i => i.fieldLabel === 'Email')
    expect(emailItems.length).toBe(1)
    // Override items come first so the llm one wins
    expect(emailItems[0].confidence).toBe('high')
  })

  it('mergeSearchIndexes skips items with empty label or value', () => {
    const base = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      items: [{ fieldLabel: '', value: 'something', aliases: [], sourceText: '', confidence: 'medium' as const }],
      autofill: {},
    }
    const override = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      items: [{ fieldLabel: 'Valid', value: 'Present', aliases: [], sourceText: 'ok', confidence: 'high' as const }],
      autofill: {},
    }
    const merged = mergeSearchIndexes(base, override)
    expect(merged.items.find(i => i.value === 'something')).toBeUndefined()
    expect(merged.items.find(i => i.value === 'Present')).toBeTruthy()
  })
})
