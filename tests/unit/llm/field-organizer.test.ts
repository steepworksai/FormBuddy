import { describe, expect, it, vi } from 'vitest'

const callLLMMock = vi.fn()

vi.mock('../../../src/lib/llm/index', () => ({
  callLLM: (...args: unknown[]) => callLLMMock(...args),
}))

describe('field organizer', () => {
  it('returns clean field entries from LLM JSON', async () => {
    callLLMMock.mockResolvedValueOnce(
      JSON.stringify({
        fields: [
          {
            label: 'Email Address',
            value: 'venkatesh.poosarla@example.com',
            sourceText: 'Email Address: venkatesh.poosarla@example.com',
          },
        ],
      })
    )

    const { organizeFieldsWithLLM } = await import('../../../src/lib/llm/fieldOrganizer')
    const result = await organizeFieldsWithLLM(
      'Email Address: venkatesh.poosarla@example.com',
      'profile.txt',
      { provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-4-6' }
    )

    expect(result).toEqual([
      expect.objectContaining({
        label: 'Email Address',
        value: 'venkatesh.poosarla@example.com',
      }),
    ])
  })

  it('returns empty list on malformed output', async () => {
    callLLMMock.mockResolvedValueOnce('not-json')
    const { organizeFieldsWithLLM } = await import('../../../src/lib/llm/fieldOrganizer')
    const result = await organizeFieldsWithLLM(
      'x',
      'profile.txt',
      { provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-4-6' }
    )
    expect(result).toEqual([])
  })
})
