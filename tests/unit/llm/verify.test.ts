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

  it('returns false for gemini 400 "API key not valid" response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' },
        }),
      })) as unknown as typeof fetch
    )

    const { verifyApiKey } = await import('../../../src/lib/llm/verify')
    const result = await verifyApiKey({
      provider: 'gemini',
      apiKey: 'bad-key',
      model: 'gemini-2.0-flash',
    })
    expect(result).toBe(false)
  })

  it('returns false for gemini 403 permission denied response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({
          error: { code: 403, message: 'Permission denied', status: 'PERMISSION_DENIED' },
        }),
      })) as unknown as typeof fetch
    )

    const { verifyApiKey } = await import('../../../src/lib/llm/verify')
    const result = await verifyApiKey({
      provider: 'gemini',
      apiKey: 'restricted-key',
      model: 'gemini-2.0-flash',
    })
    expect(result).toBe(false)
  })

  it('throws for gemini network failure (fetch TypeError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    )

    const { verifyApiKey } = await import('../../../src/lib/llm/verify')
    await expect(
      verifyApiKey({ provider: 'gemini', apiKey: 'any', model: 'gemini-2.0-flash' })
    ).rejects.toThrow('Failed to fetch')
  })
})
