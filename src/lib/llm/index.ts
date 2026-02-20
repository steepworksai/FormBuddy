import type { LLMConfig } from '../../types'
import { callClaude } from './claude'
import { callOpenAI } from './openai'

export async function callLLM(
  systemPrompt: string,
  userMessage: string,
  config: LLMConfig
): Promise<string> {
  if (config.provider === 'anthropic') {
    return callClaude(systemPrompt, userMessage, config)
  }
  return callOpenAI(systemPrompt, userMessage, config)
}
