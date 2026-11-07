import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'
import { mediaPlaceholder, type MediaRow } from './media'

/**
 * Content types the assistant either reads or must hand off. Everything else
 * (a location pin, a template, an interactive tap) is representable as text in
 * the transcript and must NOT put the thread in the "unreadable media" path —
 * a button tap that muted the thread would be a regression, not a feature.
 */
const HANDOFF_MEDIA_TYPES = new Set(['image', 'audio', 'video', 'document'])

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string | null
  content_text: string | null
  media_url: string | null
}

/**
 * The recent thread, plus the media that arrived in the batch being answered.
 *
 * `messages` is the provider-neutral chat shape. Media rows are no longer
 * dropped: a photo or voice note without a caption becomes a placeholder turn
 * (`[image]`, `[voice message]`) so the transcript keeps its shape — the model
 * must not see a question that follows a gap it cannot account for. The bytes
 * themselves are attached by the caller (`readMediaForModel`), because fetching
 * them is a network call the draft route does not need.
 *
 * Ordered oldest-first so the transcript reads naturally and the most recent
 * customer message lands last.
 */
export interface ConversationTurn {
  messages: ChatMessage[]
  /**
   * Media rows from the CURRENT inbound batch — customer messages after the
   * last assistant turn. Those are what a reply would be answering; an older
   * attachment stays a placeholder so we never pay to re-read a photo the
   * thread has already moved past.
   */
  media: MediaRow[]
}

export async function buildConversationTurn(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ConversationTurn> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text, media_url')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  // Newest-first from the DB; reverse into chronological order.
  const rows = ((data ?? []) as DbMessage[]).reverse()

  const messages: ChatMessage[] = []
  let media: MediaRow[] = []

  for (const row of rows) {
    const role: ChatMessage['role'] = row.sender_type === 'customer' ? 'user' : 'assistant'
    const contentType = (row.content_type ?? 'text').toLowerCase()
    const text = row.content_text?.trim() ?? ''

    // A media row with a caption keeps the customer's own words; without one
    // it is represented by its type, so the turn is never empty.
    const content = text || (contentType === 'text' ? '' : mediaPlaceholder(contentType))
    if (!content) continue

    messages.push({ role, content })

    if (role === 'assistant') {
      // A reply — agent or bot — closes the batch. Media before it is history.
      media = []
      continue
    }

    if (!HANDOFF_MEDIA_TYPES.has(contentType)) continue
    // A row with no URL is kept on purpose: `readMediaForModel` reports it as
    // a failed download, and the dispatcher hands the thread to a human
    // instead of answering a photo it cannot see.
    media.push({
      content_type: contentType,
      media_url: row.media_url,
      content_text: row.content_text,
    })
  }

  return { messages, media }
}

/**
 * Text-only transcript, for the inbox draft route and any caller that does not
 * read media. Kept as the simple entry point so that behaviour is unchanged
 * apart from the media placeholders.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const turn = await buildConversationTurn(db, conversationId, limit)
  return turn.messages
}
