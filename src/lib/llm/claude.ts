import Anthropic from '@anthropic-ai/sdk'
import type { LLMConfig } from '../../types'

export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  config: LLMConfig
): Promise<string> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
  })

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return block.text
}
