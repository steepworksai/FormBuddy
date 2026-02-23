import { describe, expect, it } from 'vitest'
import { shortModelName } from '../../../src/lib/utils/modelName'

describe('shortModelName', () => {
  it('returns empty string for undefined', () => {
    expect(shortModelName(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(shortModelName('')).toBe('')
  })

  // ── Claude ────────────────────────────────────────────────────────────────

  it('formats claude-sonnet-4-6', () => {
    expect(shortModelName('claude-sonnet-4-6')).toBe('Sonnet 4.6')
  })

  it('formats claude-opus-4-6', () => {
    expect(shortModelName('claude-opus-4-6')).toBe('Opus 4.6')
  })

  it('formats claude-haiku-4-5-20251001 (strips date suffix)', () => {
    expect(shortModelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  })

  it('capitalises the model name', () => {
    expect(shortModelName('claude-sonnet-4-6')[0]).toBe('S')
  })

  // ── OpenAI ────────────────────────────────────────────────────────────────

  it('formats gpt-4o', () => {
    expect(shortModelName('gpt-4o')).toBe('GPT-4o')
  })

  it('formats gpt-4o-mini', () => {
    expect(shortModelName('gpt-4o-mini')).toBe('GPT-4o mini')
  })

  // ── Gemini ────────────────────────────────────────────────────────────────

  it('formats gemini-2.5-flash', () => {
    expect(shortModelName('gemini-2.5-flash')).toBe('Gemini 2.5 flash')
  })

  it('formats gemini-2.5-flash-lite', () => {
    expect(shortModelName('gemini-2.5-flash-lite')).toBe('Gemini 2.5 flash lite')
  })

  it('formats gemini-2.5-pro', () => {
    expect(shortModelName('gemini-2.5-pro')).toBe('Gemini 2.5 pro')
  })

  // ── Unknown ───────────────────────────────────────────────────────────────

  it('returns unknown model id unchanged', () => {
    expect(shortModelName('some-custom-model')).toBe('some-custom-model')
  })
})
