import type { LLMConfig } from '../../types'

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
  error?: { code?: number; message?: string; status?: string }
}

export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  config: LLMConfig
): Promise<string> {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent` +
    `?key=${encodeURIComponent(config.apiKey)}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
      },
    }),
  })

  const data = (await response.json()) as GeminiGenerateResponse

  if (!response.ok) {
    const apiMsg = data.error?.message ?? response.statusText
    throw new Error(`[Gemini ${config.model}] HTTP ${response.status} — ${apiMsg}`)
  }

  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim()
  if (!text) throw new Error(`[Gemini ${config.model}] Empty response`)
  return text
}
