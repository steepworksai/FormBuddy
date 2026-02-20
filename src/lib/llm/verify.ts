import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { LLMConfig } from '../../types'

/**
 * Makes the smallest possible API call to confirm the key and model are valid.
 * Returns true if the call succeeds, false if authentication fails.
 * Throws for unexpected network or server errors (let the caller handle those).
 */
export async function verifyApiKey(config: LLMConfig): Promise<boolean> {
  try {
    if (config.provider === 'anthropic') {
      const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true })
      await client.messages.create({
        model: config.model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      })
    } else if (config.provider === 'openai') {
      const client = new OpenAI({ apiKey: config.apiKey, dangerouslyAllowBrowser: true })
      await client.chat.completions.create({
        model: config.model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      })
    } else {
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent` +
        `?key=${encodeURIComponent(config.apiKey)}`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Gemini verify failed (${response.status}): ${errorText}`)
      }
    }
    return true
  } catch (err) {
    // 401 / 403 = bad key, 404 = model not found — all count as "invalid"
    if (err instanceof Error) {
      const msg = err.message.toLowerCase()
      if (
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('invalid') ||
        msg.includes('authentication') ||
        msg.includes('api key') ||
        msg.includes('not found') ||
        msg.includes('permission denied') ||
        msg.includes('unauthorized')
      ) {
        return false
      }
    }
    // Unexpected error (network down, server 500, etc.) — re-throw so UI can show it
    throw err
  }
}
