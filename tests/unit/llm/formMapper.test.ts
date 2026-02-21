import { describe, expect, it, vi } from 'vitest'
import type { FormFieldInput, FormMapDocumentInput } from '../../../src/lib/llm/formMapper'

vi.mock('../../../src/lib/llm/index', () => ({
  callLLM: vi.fn(),
}))

import { callLLM } from '../../../src/lib/llm/index'
import { buildFormAutofillMapWithLLM } from '../../../src/lib/llm/formMapper'

const mockCallLLM = callLLM as ReturnType<typeof vi.fn>

const config = { provider: 'anthropic' as const, apiKey: 'test-key', model: 'claude-sonnet-4-6' }

const fields: FormFieldInput[] = [
  { fieldId: 'first_name', fieldLabel: 'First Name' },
  { fieldId: 'email', fieldLabel: 'Email Address' },
  { fieldId: 'dob', fieldLabel: 'Date of Birth' },
]

const documents: FormMapDocumentInput[] = [
  {
    fileName: 'profile.pdf',
    autofill: { first_name: 'Jane Doe' },
    items: [{ fieldLabel: 'Email', value: 'jane@example.com', aliases: [] }],
  },
]

describe('buildFormAutofillMapWithLLM', () => {
  it('returns empty array when fields list is empty', async () => {
    const result = await buildFormAutofillMapWithLLM([], documents, config)
    expect(result).toEqual([])
  })

  it('returns empty array when documents list is empty', async () => {
    const result = await buildFormAutofillMapWithLLM(fields, [], config)
    expect(result).toEqual([])
  })

  it('parses key-value pairs from LLM response', async () => {
    mockCallLLM.mockResolvedValueOnce(
      'First Name: Jane Doe\nEmail Address: jane@example.com\nDate of Birth: 1990-05-20'
    )
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result.length).toBe(3)
    expect(result.find(r => r.fieldLabel === 'First Name')?.value).toBe('Jane Doe')
    expect(result.find(r => r.fieldLabel === 'Email Address')?.value).toBe('jane@example.com')
    expect(result.find(r => r.fieldLabel === 'Date of Birth')?.value).toBe('1990-05-20')
  })

  it('strips markdown fences from response', async () => {
    mockCallLLM.mockResolvedValueOnce(
      '```json\nFirst Name: Jane Doe\nEmail Address: jane@example.com\n```'
    )
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result.find(r => r.fieldLabel === 'First Name')?.value).toBe('Jane Doe')
  })

  it('filters out "Not found" values', async () => {
    mockCallLLM.mockResolvedValueOnce(
      'First Name: Jane Doe\nEmail Address: not found\nDate of Birth: NOT FOUND'
    )
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result.find(r => r.fieldLabel === 'Email Address')).toBeUndefined()
    expect(result.find(r => r.fieldLabel === 'Date of Birth')).toBeUndefined()
    expect(result.find(r => r.fieldLabel === 'First Name')?.value).toBe('Jane Doe')
  })

  it('skips lines without colon separator', async () => {
    mockCallLLM.mockResolvedValueOnce(
      'First Name - Jane Doe\nEmail Address: jane@example.com'
    )
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result.length).toBe(1)
    expect(result[0].fieldLabel).toBe('Email Address')
  })

  it('skips lines with empty label or value', async () => {
    mockCallLLM.mockResolvedValueOnce(
      ': some value\nFirst Name: \nEmail Address: jane@example.com'
    )
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result.length).toBe(1)
    expect(result[0].value).toBe('jane@example.com')
  })

  it('deduplicates entries by normalized field ID', async () => {
    mockCallLLM.mockResolvedValueOnce(
      'First Name: Jane Doe\nFirst Name: Jane Smith'
    )
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    const firstNameResults = result.filter(r => r.fieldLabel === 'First Name')
    expect(firstNameResults.length).toBe(1)
    expect(firstNameResults[0].value).toBe('Jane Doe')
  })

  it('matches by fieldLabel to existing fields', async () => {
    mockCallLLM.mockResolvedValueOnce('First Name: Jane Doe')
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result[0].fieldId).toBe('first_name')
  })

  it('falls back to generated fieldId for unknown labels', async () => {
    mockCallLLM.mockResolvedValueOnce('Loyalty Number: LY-99999')
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result[0].fieldId).toBe('loyalty_number')
    expect(result[0].value).toBe('LY-99999')
  })

  it('sets sourceFile from first document', async () => {
    mockCallLLM.mockResolvedValueOnce('First Name: Jane Doe')
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result[0].sourceFile).toBe('profile.pdf')
  })

  it('sets confidence to medium', async () => {
    mockCallLLM.mockResolvedValueOnce('Email Address: jane@example.com')
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result[0].confidence).toBe('medium')
  })

  it('uses rawFieldsInput when provided', async () => {
    mockCallLLM.mockResolvedValueOnce('Custom Label: custom value')
    const result = await buildFormAutofillMapWithLLM(fields, documents, config, {
      rawFieldsInput: 'Custom Label',
    })
    expect(result[0].fieldLabel).toBe('Custom Label')
    expect(result[0].value).toBe('custom value')
  })

  it('passes correct system prompt and user payload to callLLM', async () => {
    mockCallLLM.mockResolvedValueOnce('First Name: Jane Doe')
    await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(mockCallLLM).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('form_fields'),
      config
    )
  })

  it('returns empty array on totally unparseable response', async () => {
    mockCallLLM.mockResolvedValueOnce('no colons at all in this response text')
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result).toEqual([])
  })

  it('handles value containing colons correctly', async () => {
    mockCallLLM.mockResolvedValueOnce('Date of Birth: 1990-05-20T00:00:00Z')
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result[0].value).toBe('1990-05-20T00:00:00Z')
  })

  it('handles CRLF line endings', async () => {
    mockCallLLM.mockResolvedValueOnce(
      'First Name: Jane Doe\r\nEmail Address: jane@example.com\r\n'
    )
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result.length).toBe(2)
    expect(result.find(r => r.fieldLabel === 'First Name')?.value).toBe('Jane Doe')
    expect(result.find(r => r.fieldLabel === 'Email Address')?.value).toBe('jane@example.com')
  })

  it('returns empty array for whitespace-only response', async () => {
    mockCallLLM.mockResolvedValueOnce('   \n\n   \n   ')
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result).toEqual([])
  })

  it('skips lines that start with a colon (empty label)', async () => {
    mockCallLLM.mockResolvedValueOnce(':value without label\nFirst Name: Jane Doe')
    const result = await buildFormAutofillMapWithLLM(fields, documents, config)
    expect(result.length).toBe(1)
    expect(result[0].fieldLabel).toBe('First Name')
  })
})
