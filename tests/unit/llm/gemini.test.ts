import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callGemini } from '../../../src/lib/llm/gemini'

const config = { provider: 'gemini' as const, apiKey: 'test-key', model: 'gemini-2.0-flash' }

function makeFetchResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('callGemini', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns text from candidates[0].content.parts[0]', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({
        candidates: [{ content: { parts: [{ text: 'Hello world' }] } }],
      })
    )
    const result = await callGemini('sys', 'user msg', config)
    expect(result).toBe('Hello world')
  })

  it('joins multiple parts into a single string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({
        candidates: [{ content: { parts: [{ text: 'Part one ' }, { text: 'part two' }] } }],
      })
    )
    const result = await callGemini('sys', 'user msg', config)
    expect(result).toBe('Part one part two')
  })

  it('throws on non-ok HTTP response with status code', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse('Bad Request', false, 400)
    )
    await expect(callGemini('sys', 'user msg', config)).rejects.toThrow('Gemini API error (400)')
  })

  it('throws when candidates array is empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({ candidates: [] })
    )
    await expect(callGemini('sys', 'user msg', config)).rejects.toThrow('Empty response from Gemini')
  })

  it('throws when text assembled from parts is empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({
        candidates: [{ content: { parts: [{ text: '   ' }] } }],
      })
    )
    await expect(callGemini('sys', 'user msg', config)).rejects.toThrow('Empty response from Gemini')
  })

  it('throws when candidates key is missing entirely', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeFetchResponse({}))
    await expect(callGemini('sys', 'user msg', config)).rejects.toThrow('Empty response from Gemini')
  })

  it('sends model and apiKey in the request URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      })
    )
    await callGemini('sys', 'user msg', config)
    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('gemini-2.0-flash')
    expect(url).toContain('test-key')
  })

  it('sends system prompt and user message in request body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      })
    )
    await callGemini('Be helpful', 'Fill this form', config)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.system_instruction.parts[0].text).toBe('Be helpful')
    expect(body.contents[0].parts[0].text).toBe('Fill this form')
  })
})
