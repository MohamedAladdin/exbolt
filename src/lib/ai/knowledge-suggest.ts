import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Turn real conversations into knowledge-base *proposals*.
 *
 * The ground truth is a human: when a teammate answers a customer's question
 * in the inbox, that pair is exactly what the assistant should have known.
 * This module pairs them up **without calling a model** — deterministic,
 * free, and impossible to hallucinate — and stores each pair as a `draft`
 * suggestion. Nothing reaches the knowledge base until an admin approves it.
 */

export interface KnowledgeSuggestion {
  question: string
  answer: string
}

interface MessageRow {
  sender_type: string | null
  ai_generated: boolean | null
  content_text: string | null
  /** ISO timestamp; when present the pairing is bounded in time. */
  created_at?: string | null
}

const MIN_QUESTION_LEN = 8
const MIN_ANSWER_LEN = 15
const MAX_QUESTION_LEN = 400
const MAX_ANSWER_LEN = 2000
const MAX_SUGGESTIONS = 10
/** A human answering within half an hour is answering *this* customer. */
const MAX_PAIR_GAP_MINUTES = 30

/**
 * Arabic question markers. A clinic thread is full of statements
 * («نتيجة التحليل ظهرت خلاص»); pairing those with whatever the agent typed
 * next produces noise, and noise in the knowledge base is worse than an
 * empty one.
 */
const QUESTION_MARKERS =
  /(\?|؟|\b(?:ايه|إيه|كام|فين|امتى|إمتى|متى|هل|ينفع|ممكن|عايز|عاوز|ازاي|إزاي|ليه|بتفتحوا|مواعيد|سعر|تكلفة|الأسعار)\b)/i

/** Openers that are politeness, not an answer. */
const GENERIC_ANSWER =
  /^(?:تمام|تحت امرك|تحت أمرك|اهلا|أهلا|وعليكم السلام|السلام عليكم|شكرا|شكرًا|مساء الخير|صباح الخير|ابعت|أبعت)[\s.!،,]*$/i

/** Collapse whitespace and unify the trailing punctuation so duplicates match. */
/** Does this customer message look like something worth answering? */
export function looksLikeQuestion(text: string): boolean {
  const value = text.trim()
  if (value.length < MIN_QUESTION_LEN || value.length > MAX_QUESTION_LEN) return false
  return QUESTION_MARKERS.test(value)
}

/** Minutes between two ISO timestamps, or null when either is unusable. */
function gapMinutes(fromIso?: string | null, toIso?: string | null): number | null {
  if (!fromIso || !toIso) return null
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return (to - from) / 60000
}

export function normalizeQuestion(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[؟?.!，,。]+$/g, '')
    .trim()
}

/**
 * Pair each customer question with the next HUMAN answer in the same thread.
 *
 * Rules that keep the output useful rather than noisy:
 *   - the answer must come from a person (`sender_type = 'agent'` and not
 *     `ai_generated`), so the bot never learns from itself;
 *   - a bot message between the question and the human answer drops the pair
 *     (the human was correcting the bot, not answering the question);
 *   - questions and answers outside the length bounds are skipped;
 *   - identical questions collapse to one suggestion.
 */
export function buildSuggestions(messages: MessageRow[]): KnowledgeSuggestion[] {
  const out: KnowledgeSuggestion[] = []
  const seen = new Set<string>()

  for (let i = 0; i < messages.length; i += 1) {
    const row = messages[i]
    if (row.sender_type !== 'customer') continue
    const rawQuestion = row.content_text ?? ''
    if (!looksLikeQuestion(rawQuestion)) continue
    const question = normalizeQuestion(rawQuestion)

    for (let j = i + 1; j < messages.length; j += 1) {
      const next = messages[j]
      if (next.sender_type === 'customer') break // the customer moved on
      if (next.ai_generated) break // the bot talked: not a human answer
      if (next.sender_type !== 'agent') continue
      const answer = (next.content_text ?? '').trim()
      if (answer.length < MIN_ANSWER_LEN) break
      if (answer.length > MAX_ANSWER_LEN) break
      if (GENERIC_ANSWER.test(answer)) break
      const gap = gapMinutes(row.created_at, next.created_at)
      if (gap !== null && (gap < 0 || gap > MAX_PAIR_GAP_MINUTES)) break
      const key = question.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        out.push({ question, answer })
      }
      break
    }

    if (out.length >= MAX_SUGGESTIONS) break
  }

  return out
}

/**
 * Build suggestions for one conversation and store the new ones as drafts.
 *
 * Duplicates are ignored by the table's `UNIQUE (account_id, question)`, so a
 * weekly job re-reading the same thread is harmless. Returns how many rows
 * were actually inserted.
 */
export async function suggestFromConversation(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; limit?: number },
): Promise<number> {
  const { accountId, conversationId, limit = 60 } = args

  const { data, error } = await db
    .from('messages')
    .select('sender_type, ai_generated, content_text, created_at')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'text')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error || !data) {
    if (error) console.warn('[ai suggestions] read failed:', error.message)
    return 0
  }

  const suggestions = buildSuggestions(data as MessageRow[])
  if (suggestions.length === 0) return 0

  const rows = suggestions.map((s) => ({
    account_id: accountId,
    question: s.question,
    answer: s.answer,
    source_conversation_id: conversationId,
    status: 'draft' as const,
  }))

  // `ignoreDuplicates` keeps the existing row (and its review status) when the
  // same question was already proposed or dismissed before.
  const { data: inserted, error: insertErr } = await db
    .from('ai_knowledge_suggestions')
    .upsert(rows, {
      onConflict: 'account_id,question',
      ignoreDuplicates: true,
    })
    .select('id')

  if (insertErr) {
    console.warn('[ai suggestions] insert failed:', insertErr.message)
    return 0
  }
  return inserted?.length ?? 0
}
