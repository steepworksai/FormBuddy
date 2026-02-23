import { describe, expect, it, vi } from 'vitest'

const callClaudeMock = vi.fn(async () => 'claude-result')
const callOpenAIMock = vi.fn(async () => 'openai-result')
const callGeminiMock = vi.fn(async () => 'gemini-result')

vi.mock('../../../src/lib/llm/claude', () => ({
  callClaude: callClaudeMock,
}))
vi.mock('../../../src/lib/llm/openai', () => ({
  callOpenAI: callOpenAIMock,
}))
vi.mock('../../../src/lib/llm/gemini', () => ({
  callGemini: callGeminiMock,
}))

describe('TM3 callLLM provider dispatch', () => {
  it('routes anthropic provider to Claude', async () => {
    const { callLLM } = await import('../../../src/lib/llm/index')
    const result = await callLLM('s', 'u', {
      provider: 'anthropic',
      apiKey: 'x',
      model: 'claude-sonnet-4-6',
    })
    expect(result).toBe('claude-result')
    expect(callClaudeMock).toHaveBeenCalledTimes(1)
  })

  it('routes openai provider to OpenAI', async () => {
    const { callLLM } = await import('../../../src/lib/llm/index')
    const result = await callLLM('s', 'u', {
      provider: 'openai',
      apiKey: 'x',
      model: 'gpt-4o',
    })
    expect(result).toBe('openai-result')
    expect(callOpenAIMock).toHaveBeenCalledTimes(1)
  })

  it('routes gemini provider to Gemini', async () => {
    const { callLLM } = await import('../../../src/lib/llm/index')
    const result = await callLLM('s', 'u', {
      provider: 'gemini',
      apiKey: 'x',
      model: 'gemini-2.5-flash',
    })
    expect(result).toBe('gemini-result')
    expect(callGeminiMock).toHaveBeenCalledTimes(1)
  })
})
