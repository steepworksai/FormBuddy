import OpenAI from 'openai'
import type { LLMConfig } from '../../types'

export async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  config: LLMConfig
): Promise<string> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
  })

  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  })

  const text = response.choices[0]?.message?.content
  if (!text) throw new Error('Empty response from OpenAI')
  return text
}
