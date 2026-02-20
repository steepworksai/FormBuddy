import { describe, expect, it, vi } from 'vitest'

const callLLMMock = vi.fn()

vi.mock('../../../src/lib/llm/index', () => ({
  callLLM: callLLMMock,
}))

describe('TM3 suggestion parsing', () => {
  it('returns structured suggestion when LLM gives valid JSON', async () => {
    callLLMMock.mockResolvedValueOnce(
      JSON.stringify({
        value: 'AB1234567',
        sourceFile: 'passport.pdf',
        sourcePage: 1,
        sourceText: 'Passport Number AB1234567',
        reason: 'Found in passport number line',
        confidence: 'high',
      })
    )

    const { generateSuggestionWithLLM } = await import('../../../src/lib/llm/suggestion')
    const result = await generateSuggestionWithLLM(
      'passport_number',
      'Passport Number',
      [{ documentId: 'd1', fileName: 'passport.pdf', sourcePage: 1, sourceText: 'Passport Number AB1234567', score: 4 }],
      { provider: 'anthropic', apiKey: 'x', model: 'claude-sonnet-4-6' }
    )

    expect(result?.value).toBe('AB1234567')
    expect(result?.confidence).toBe('high')
  })

  it('returns null when value is null', async () => {
    callLLMMock.mockResolvedValueOnce(
      JSON.stringify({
        value: null,
        sourceFile: '',
        sourcePage: 1,
        sourceText: '',
        reason: '',
        confidence: 'low',
      })
    )

    const { generateSuggestionWithLLM } = await import('../../../src/lib/llm/suggestion')
    const result = await generateSuggestionWithLLM(
      'email',
      'Email',
      [],
      { provider: 'openai', apiKey: 'x', model: 'gpt-4o' }
    )

    expect(result).toBeNull()
  })
})
