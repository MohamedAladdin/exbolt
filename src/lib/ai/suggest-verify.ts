import type { AiConfig } from './types'
import { completeOnce } from './complete'
import type { KnowledgeSuggestion } from './knowledge-suggest'

/**
 * The reviewer that keeps junk out of the knowledge base.
 *
 * The heuristic in `knowledge-suggest.ts` can only see *order*: it knows a
 * human replied after a question, not that the reply answered it. In a real
 * clinic thread the agent is often answering the customer's third message, so
 * order alone produces plausible-looking garbage («بس معتقدش أكسا فى تعاقد» →
 * «سن حضرتك كام سنه؟»).
 *
 * So each candidate batch passes through one bounded model call that keeps
 * only genuine question/answer pairs, rewrites them as standalone text, and
 * strips personal data (a knowledge base is not a patient file). A provider
 * failure means "no suggestions this round", never "insert the raw guesses".
 */

export const MAX_VERIFIED = 8

const SYSTEM_PROMPT = [
  'You review candidate FAQ pairs extracted from a clinic support chat.',
  'For each candidate decide whether the ANSWER genuinely answers the QUESTION.',
  'Keep a pair only when a future customer asking that same question would be correctly served by that answer.',
  'Drop: greetings and small talk, answers about a different topic, answers that only ask for more details, and anything containing personal data (patient names, phone numbers, file numbers, addresses).',
  'Rewrite the kept pair as standalone text in the customer\'s own language: a short question, then the answer (max 3 sentences), with no personal data and no greetings.',
  'Return ONLY minified JSON, no prose, no code fences:',
  '{"keep":[{"i":0,"question":"…","answer":"…"}]}',
  'An empty result is a valid answer: {"keep":[]}.',
].join('\n')

/** Parse the verifier's JSON. Total function: junk in → [] out. */
export function parseVerified(
  raw: string,
  candidates: KnowledgeSuggestion[],
): KnowledgeSuggestion[] {
  const text = (raw ?? '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }

  const list = (parsed as { keep?: unknown }).keep
  if (!Array.isArray(list)) return []

  const out: KnowledgeSuggestion[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const index = Number(record.i)
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) continue
    const question =
      typeof record.question === 'string' ? record.question.trim() : ''
    const answer = typeof record.answer === 'string' ? record.answer.trim() : ''
    if (question.length < 8 || question.length > 400) continue
    if (answer.length < 10 || answer.length > 1200) continue
    const key = question.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ question, answer })
    if (out.length >= MAX_VERIFIED) break
  }
  return out
}

/**
 * Verify one conversation's candidate pairs with a single model call.
 *
 * Throws `AiError` when the provider fails, so the caller can decide to skip
 * the conversation rather than store unverified guesses.
 */
export async function verifySuggestions(
  config: AiConfig,
  candidates: KnowledgeSuggestion[],
): Promise<KnowledgeSuggestion[]> {
  if (candidates.length === 0) return []

  const payload = candidates
    .map((c, i) => `${i}. Q: ${c.question}\n   A: ${c.answer}`)
    .join('\n\n')

  const raw = await completeOnce(config, SYSTEM_PROMPT, [
    { role: 'user', content: payload },
  ])
  return parseVerified(raw, candidates)
}
