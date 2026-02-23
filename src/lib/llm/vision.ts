import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { LLMConfig } from '../../types'

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

const VISION_PROMPT =
  'Extract all visible text from this image exactly as it appears. ' +
  'Preserve every label, value, number, date, code, and identifier. ' +
  'Keep label/value pairs on separate lines. ' +
  'Do not rephrase, reformat, or omit anything. ' +
  'Return only the extracted text — no commentary, no markdown.'

async function visionAnthropic(base64: string, mediaType: ImageMediaType, config: LLMConfig): Promise<string> {
  const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true })
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: VISION_PROMPT },
      ],
    }],
  })
  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude vision')
  return block.text.trim()
}

async function visionGemini(base64: string, mediaType: ImageMediaType, config: LLMConfig): Promise<string> {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent` +
    `?key=${encodeURIComponent(config.apiKey)}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: mediaType, data: base64 } },
          { text: VISION_PROMPT },
        ],
      }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0 },
    }),
  })
  if (!response.ok) {
    const msg = await response.text()
    throw new Error(`Gemini vision error (${response.status}): ${msg}`)
  }
  const body = await response.json()
  return (body?.candidates?.[0]?.content?.parts as Array<{ text?: string }> ?? [])
    .map(p => p.text ?? '').join('').trim()
}

async function visionOpenAI(base64: string, mediaType: ImageMediaType, config: LLMConfig): Promise<string> {
  const client = new OpenAI({ apiKey: config.apiKey, dangerouslyAllowBrowser: true })
  const response = await client.chat.completions.create({
    model: config.model,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
        { type: 'text', text: VISION_PROMPT },
      ],
    }],
  })
  return response.choices[0]?.message?.content?.trim() ?? ''
}

/**
 * Sends a base64-encoded image to the configured LLM provider for OCR.
 * Supports Anthropic, Gemini, and OpenAI.
 */
export async function extractTextWithVision(
  base64: string,
  mediaType: ImageMediaType,
  config: LLMConfig
): Promise<string> {
  if (config.provider === 'gemini')    return visionGemini(base64, mediaType, config)
  if (config.provider === 'openai')    return visionOpenAI(base64, mediaType, config)
  if (config.provider === 'anthropic') return visionAnthropic(base64, mediaType, config)
  throw new Error(`Unsupported provider for vision: ${config.provider}`)
}

/** Convert an HTMLCanvasElement to a base64 JPEG string (smaller than PNG). */
export function canvasToBase64(canvas: HTMLCanvasElement): { base64: string; mediaType: ImageMediaType } {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  const base64 = dataUrl.split(',')[1]
  return { base64, mediaType: 'image/jpeg' }
}

function inferImageMediaType(file: File): ImageMediaType {
  const t = (file.type || '').toLowerCase()
  if (t === 'image/png' || t === 'image/jpeg' || t === 'image/webp') return t

  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'

  return 'image/jpeg'
}

/** Convert a File to a base64 string, preserving its media type. */
export async function fileToBase64(file: File): Promise<{ base64: string; mediaType: ImageMediaType }> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)
  const mediaType = inferImageMediaType(file)
  return { base64, mediaType }
}
