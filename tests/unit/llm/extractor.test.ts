import { describe, expect, it, vi } from 'vitest'

const callLLMMock = vi.fn()

vi.mock('../../../src/lib/llm/index', () => ({
  callLLM: callLLMMock,
}))

describe('TM3 extractor parsing', () => {
  it('parses valid JSON response', async () => {
    callLLMMock.mockResolvedValueOnce(
      JSON.stringify({
        entities: { names: ['John Doe'] },
        summary: 'Example summary',
      })
    )

    const { extractEntitiesWithLLM } = await import('../../../src/lib/llm/extractor')
    const result = await extractEntitiesWithLLM('raw text', 'sample.txt', {
      provider: 'openai',
      apiKey: 'x',
      model: 'gpt-4o',
    })

    expect(result.summary).toBe('Example summary')
    expect(result.entities.names).toContain('John Doe')
    expect(result.entities.identifiers).toEqual([])
  })

  it('handles markdown-fenced JSON', async () => {
    callLLMMock.mockResolvedValueOnce(
      '```json\n{"entities":{"identifiers":["ABC-1"]},"summary":"ok"}\n```'
    )

    const { extractEntitiesWithLLM } = await import('../../../src/lib/llm/extractor')
    const result = await extractEntitiesWithLLM('raw text', 'sample.txt', {
      provider: 'anthropic',
      apiKey: 'x',
      model: 'claude-sonnet-4-6',
    })

    expect(result.entities.identifiers).toEqual(['ABC-1'])
    expect(result.summary).toBe('ok')
  })

  it('returns empty result when model output is malformed JSON', async () => {
    callLLMMock.mockResolvedValueOnce('not-json')

    const { extractEntitiesWithLLM } = await import('../../../src/lib/llm/extractor')
    const result = await extractEntitiesWithLLM('raw text', 'sample.txt', {
      provider: 'gemini',
      apiKey: 'x',
      model: 'gemini-2.0-flash',
    })

    expect(result.summary).toBe('')
    expect(result.entities.names).toEqual([])
  })
})
