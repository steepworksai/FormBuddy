import Anthropic from '@anthropic-ai/sdk'
import type { LLMConfig } from '../../types'

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

const VISION_PROMPT =
  'Extract all text from this image exactly as it appears. ' +
  'Preserve structure, numbers, dates, and special characters. ' +
  'Return only the extracted text — no commentary, no markdown.'

/**
 * Sends a base64-encoded image to Claude vision and returns the extracted text.
 * Only works when the configured provider is Anthropic.
 */
export async function extractTextWithVision(
  base64: string,
  mediaType: ImageMediaType,
  config: LLMConfig
): Promise<string> {
  if (config.provider !== 'anthropic') {
    throw new Error('Vision fallback requires an Anthropic API key')
  }

  const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true })

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          { type: 'text', text: VISION_PROMPT },
        ],
      },
    ],
  })

  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude vision')
  return block.text.trim()
}

/** Convert an HTMLCanvasElement to a base64 JPEG string (smaller than PNG). */
export function canvasToBase64(canvas: HTMLCanvasElement): { base64: string; mediaType: ImageMediaType } {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  const base64 = dataUrl.split(',')[1]
  return { base64, mediaType: 'image/jpeg' }
}

/** Convert a File to a base64 string, preserving its media type. */
export async function fileToBase64(file: File): Promise<{ base64: string; mediaType: ImageMediaType }> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)
  const mediaType = (file.type as ImageMediaType) || 'image/jpeg'
  return { base64, mediaType }
}
