import type { ChatMessage } from './types'

/**
 * The text to retrieve knowledge against: the most recent customer
 * (`user`) turn in the conversation context. Falls back to the last
 * message of any role, then empty string. Shared by the draft route and
 * the auto-reply bot so both query the knowledge base the same way.
 */
export function latestUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content
  }
  return messages.length > 0 ? messages[messages.length - 1].content : ''
}

/** Media placeholders and transcript labels the model must not retrieve on. */
const MEDIA_MARKER =
  /\[(?:image|photo|voice message|voice note|video|document|location|media|audio)\]/gi
const TRANSCRIPT_MARKER = /\[voice message transcription\]/gi

/**
 * The text to search the knowledge base with, cleaned of media markers: a
 * customer who sends a photo with the caption "نتيجة التحليل" should retrieve
 * on "نتيجة التحليل", and a photo with no caption should not retrieve on the
 * literal string "[image]". Returns '' when the turn carries no words at all,
 * so the caller can decide (it still wants the pinned knowledge loaded).
 */
export function knowledgeQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue
    const cleaned = messages[i].content
      .replace(TRANSCRIPT_MARKER, ' ')
      .replace(MEDIA_MARKER, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (cleaned.length >= 2) return cleaned
  }
  return ''
}
