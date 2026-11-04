import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'
import { getT } from '@/lib/i18n/translate'

const t = getT('LibErrors')

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    /** Prompt-cache counters, present only when a breakpoint was sent. */
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
/**
 * Split the system prompt into [stable, variable] and mark the stable part as
 * a cache breakpoint.
 *
 * Anthropic's prompt cache is opt-in: without `cache_control` every input token
 * is billed in full, every call. The stable part (scaffold + the account's
 * instructions + the pinned knowledge passages) is byte-identical between
 * calls, so putting the breakpoint there turns it into ~10% of the price on
 * every subsequent turn — but only if the *prefix* is identical, which is why
 * the variable retrieved passages must come after the breakpoint, and why the
 * provider caches a prefix (everything up to the marked block) rather than an
 * arbitrary middle slice.
 *
 * Cache writes cost 1.25× once; reads 0.1×. Below the model's minimum
 * cacheable length (2048 tokens on Haiku 4.5) the API silently ignores it —
 * visible in the response's `cache_read_input_tokens` staying 0.
 */
export function buildAnthropicSystem(
  systemPrompt: string,
  stableLength?: number,
): string | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] {
  const raw = Math.floor(stableLength ?? 0)
  if (!Number.isFinite(raw) || raw <= 0) return systemPrompt
  // A boundary at (or past) the end still deserves the breakpoint: there is
  // simply no variable part after it.
  const cut = Math.min(raw, systemPrompt.length)
  const stable = systemPrompt.slice(0, cut).trimEnd()
  const variable = systemPrompt.slice(cut).trimStart()
  if (!stable) return systemPrompt
  const blocks: {
    type: 'text'
    text: string
    cache_control?: { type: 'ephemeral' }
  }[] = [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }]
  if (variable) blocks.push({ type: 'text', text: variable })
  return blocks
}

export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args
  const system = buildAnthropicSystem(systemPrompt, args.stablePrefixLength)

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: normalizeForAnthropic(messages),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Anthropic', res)
  }

  const data = (await res.json().catch(() => null)) as AnthropicResponse | null
  const text = data?.content
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw new AiError(t('ai.emptyResponse', { provider: 'Anthropic' }), {
      code: 'empty_response',
    })
  }
  // Proof that the cache breakpoint is doing something: a hit shows up as
  // cache_read_input_tokens. Zero on every call means the prefix is shorter
  // than the model's minimum cacheable length (or not byte-identical).
  const cacheRead = data?.usage?.cache_read_input_tokens ?? 0
  const cacheWrite = data?.usage?.cache_creation_input_tokens ?? 0
  if (Array.isArray(system)) {
    // Always log when a breakpoint was actually sent: zeros here mean the API
    // ignored it (prefix below the model's minimum cacheable length) rather
    // than "the feature is off".
    console.info(
      `[ai cache] sent stableChars=${system[0]?.text?.length ?? 0} read=${cacheRead} write=${cacheWrite} input=${data?.usage?.input_tokens ?? 0}`,
    )
  }

  // Anthropic reports input/output but no total — normalizeUsage sums.
  const usage = normalizeUsage({
    prompt: data?.usage?.input_tokens,
    completion: data?.usage?.output_tokens,
  })
  return { text, usage }
}
