import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/llm/index', () => ({
  callLLM: vi.fn(),
}))

import { callLLM } from '../../../src/lib/llm/index'
import { buildSearchIndexWithLLM } from '../../../src/lib/llm/searchIndex'
import type { FieldEntry, LLMConfig } from '../../../src/types'

const mockCallLLM = callLLM as ReturnType<typeof vi.fn>
const config: LLMConfig = { provider: 'anthropic', apiKey: 'test-key', model: 'claude-sonnet-4-6' }

function makeFields(count = 1): FieldEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `Field ${i}`,
    value: `Value ${i}`,
    confidence: 'medium' as const,
    boundingContext: `Context for field ${i}`,
  }))
}

describe('buildSearchIndexWithLLM', () => {
  it('returns parsed items from valid JSON response', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({
      autofill: { email_address: 'user@example.com' },
      items: [
        {
          fieldLabel: 'Email Address',
          value: 'user@example.com',
          aliases: ['email', 'e-mail'],
          sourceText: 'Email: user@example.com',
          confidence: 'high',
        },
      ],
    }))

    const result = await buildSearchIndexWithLLM('raw document text', makeFields(), 'doc.pdf', config)

    expect(result.version).toBe('1.0')
    expect(result.items.length).toBe(1)
    expect(result.items[0].fieldLabel).toBe('Email Address')
    expect(result.items[0].value).toBe('user@example.com')
    expect(result.items[0].aliases).toEqual(['email', 'e-mail'])
    expect(result.items[0].confidence).toBe('high')
    expect(result.autofill?.email_address).toBe('user@example.com')
  })

  it('strips markdown fences before parsing', async () => {
    mockCallLLM.mockResolvedValueOnce(
      '```json\n' + JSON.stringify({
        autofill: {},
        items: [{ fieldLabel: 'Name', value: 'John', aliases: [], sourceText: 'Name: John', confidence: 'medium' }],
      }) + '\n```'
    )

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.items[0].fieldLabel).toBe('Name')
  })

  it('returns empty items on malformed JSON', async () => {
    mockCallLLM.mockResolvedValueOnce('this is not json at all')

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.items).toEqual([])
    expect(result.autofill).toEqual({})
  })

  it('deduplicates items with same fieldLabel and value', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({
      autofill: {},
      items: [
        { fieldLabel: 'Email', value: 'user@example.com', aliases: [], sourceText: 'Email', confidence: 'high' },
        { fieldLabel: 'Email', value: 'user@example.com', aliases: [], sourceText: 'Email dup', confidence: 'high' },
      ],
    }))

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.items.length).toBe(1)
  })

  it('skips items with empty fieldLabel or value', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({
      autofill: {},
      items: [
        { fieldLabel: '', value: 'some value', aliases: [], sourceText: '', confidence: 'medium' },
        { fieldLabel: 'Name', value: '', aliases: [], sourceText: '', confidence: 'medium' },
        { fieldLabel: 'Valid', value: 'Present', aliases: [], sourceText: 'Valid: Present', confidence: 'high' },
      ],
    }))

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.items.length).toBe(1)
    expect(result.items[0].fieldLabel).toBe('Valid')
  })

  it('skips items with value longer than 240 chars', async () => {
    const longValue = 'x'.repeat(241)
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({
      autofill: {},
      items: [
        { fieldLabel: 'Long', value: longValue, aliases: [], sourceText: 'Long', confidence: 'low' },
        { fieldLabel: 'Short', value: 'OK', aliases: [], sourceText: 'Short', confidence: 'high' },
      ],
    }))

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.items.find(i => i.fieldLabel === 'Long')).toBeUndefined()
    expect(result.items.find(i => i.fieldLabel === 'Short')).toBeTruthy()
  })

  it('truncates rawText exceeding MAX_TEXT_CHARS', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({ autofill: {}, items: [] }))

    const longText = 'x'.repeat(15000)
    await buildSearchIndexWithLLM(longText, makeFields(), 'doc.pdf', config)

    const userMessage = JSON.parse((mockCallLLM.mock.calls[0][1]) as string)
    expect(userMessage.text).toContain('[text truncated]')
    expect(userMessage.text.length).toBeLessThan(15000)
  })

  it('does NOT truncate rawText within MAX_TEXT_CHARS', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({ autofill: {}, items: [] }))

    const shortText = 'x'.repeat(100)
    await buildSearchIndexWithLLM(shortText, makeFields(), 'doc.pdf', config)

    const userMessage = JSON.parse((mockCallLLM.mock.calls[0][1]) as string)
    expect(userMessage.text).not.toContain('[text truncated]')
  })

  it('normalizes aliases — deduplicates case-insensitively', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({
      autofill: {},
      items: [
        {
          fieldLabel: 'Email',
          value: 'user@example.com',
          aliases: ['Email', 'email', 'EMAIL'],
          sourceText: '',
          confidence: 'medium',
        },
      ],
    }))

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.items[0].aliases.length).toBe(1)
  })

  it('normalizes autofill keys to snake_case', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({
      autofill: { 'Full Name': 'John Doe', '  email_address  ': 'john@example.com' },
      items: [],
    }))

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.autofill?.full_name).toBe('John Doe')
    expect(result.autofill?.email_address).toBe('john@example.com')
  })

  it('skips autofill values exceeding 240 chars', async () => {
    const longVal = 'x'.repeat(241)
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({
      autofill: { long_key: longVal, short_key: 'ok' },
      items: [],
    }))

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.autofill?.long_key).toBeUndefined()
    expect(result.autofill?.short_key).toBe('ok')
  })

  it('uses value as sourceText when sourceText is missing', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({
      autofill: {},
      items: [
        { fieldLabel: 'Phone', value: '555-1234', aliases: [], confidence: 'medium' },
      ],
    }))

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.items[0].sourceText).toBe('555-1234')
  })

  it('defaults confidence to medium when not provided', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({
      autofill: {},
      items: [
        { fieldLabel: 'Phone', value: '555-1234', aliases: [], sourceText: 'Phone: 555-1234' },
      ],
    }))

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.items[0].confidence).toBe('medium')
  })

  it('limits items to MAX_ITEMS (120)', async () => {
    const items = Array.from({ length: 150 }, (_, i) => ({
      fieldLabel: `Field ${i}`,
      value: `Value ${i}`,
      aliases: [],
      sourceText: `Field ${i}: Value ${i}`,
      confidence: 'medium',
    }))
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({ autofill: {}, items }))

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.items.length).toBeLessThanOrEqual(120)
  })

  it('passes fileName, text, and fields to LLM', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({ autofill: {}, items: [] }))

    const fields = makeFields(2)
    await buildSearchIndexWithLLM('sample text', fields, 'myfile.pdf', config)

    const userMessage = JSON.parse((mockCallLLM.mock.calls[0][1]) as string)
    expect(userMessage.fileName).toBe('myfile.pdf')
    expect(userMessage.text).toBe('sample text')
    expect(userMessage.fields.length).toBe(2)
  })

  it('handles non-array aliases gracefully', async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify({
      autofill: {},
      items: [
        { fieldLabel: 'Name', value: 'John', aliases: 'not-an-array', sourceText: 'Name: John', confidence: 'high' },
      ],
    }))

    const result = await buildSearchIndexWithLLM('text', makeFields(), 'doc.pdf', config)
    expect(result.items[0].aliases).toEqual([])
  })
})
