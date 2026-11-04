import { AiError, type AiConfig, type ChatMessage } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateOpenAiCompatible } from './providers/openai-compatible'
import { generateAnthropic } from './providers/anthropic'

/**
 * One-shot text completion on the account's own key.
 *
 * Deliberately the dumbest possible call: a system prompt and a transcript.
 * No tools, no function calling, no structured-output API, no file or network
 * access beyond the provider endpoint. Everything the assistant is allowed to
 * *do* with the result is a row in Postgres that a human can review.
 *
 * (Adapted from `generate.ts`, which additionally parses the handoff sentinel
 * out of the reply — internal jobs must not react to that sentinel.)
 */
export async function completeOnce(
  config: AiConfig,
  systemPrompt: string,
  messages: ChatMessage[],
): Promise<string> {
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs: aiRequestTimeoutMs(),
    baseUrl: config.baseUrl,
  }

  switch (config.provider) {
    case 'openai':
      return (await generateOpenAi(providerArgs)).text
    case 'openai_compatible':
      return (await generateOpenAiCompatible(providerArgs)).text
    case 'anthropic':
      return (await generateAnthropic(providerArgs)).text
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }
}
