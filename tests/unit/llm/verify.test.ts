import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const anthropicCreateMock = vi.fn()
const openaiCreateMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: anthropicCreateMock,
      }
    },
  }
})

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: openaiCreateMock,
        },
      }
    },
  }
})

describe('TM3 verifyApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true for valid anthropic key flow', async () => {
    anthropicCreateMock.mockResolvedValueOnce({})
    const { verifyApiKey } = await import('../../../src/lib/llm/verify')
    const result = await verifyApiKey({
      provider: 'anthropic',
      apiKey: 'valid',
      model: 'claude-sonnet-4-6',
    })
    expect(result).toBe(true)
  })

  it('returns false for invalid openai key flow', async () => {
    openaiCreateMock.mockRejectedValueOnce(new Error('401 invalid api key'))
    const { verifyApiKey } = await import('../../../src/lib/llm/verify')
    const result = await verifyApiKey({
      provider: 'openai',
      apiKey: 'bad',
      model: 'gpt-4o',
    })
    expect(result).toBe(false)
  })

  it('supports gemini verification success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => '' })) as unknown as typeof fetch
    )

    const { verifyApiKey } = await import('../../../src/lib/llm/verify')
    const result = await verifyApiKey({
      provider: 'gemini',
      apiKey: 'valid',
      model: 'gemini-2.0-flash',
    })
    expect(result).toBe(true)
  })
})
