// ============================================================
// Forwarding an inbox message.
//
// The Cloud API has no forward endpoint: on WhatsApp, forwarding is a
// client action that re-sends the same payload to another chat. This
// app does the same thing server-side — take the source message's
// payload, send it again into each target conversation, and record
// `forwarded_from_message_id` on the new rows so the bubble can carry
// the forward marker.
//
// `forwardPayloadFor` is the pure part: given any stored message, it
// returns the payload to re-send, or the reason it cannot be forwarded
// (media whose URL is gone, a message with no text and no media, an
// inbound button tap nobody can replay).
// ============================================================

import type { Message } from '@/types';
import { basenameFromUrl } from '@/lib/media/filename';

/** WhatsApp's own multi-forward cap: five chats at a time. */
export const FORWARD_TARGET_MAX = 5;

export const FORWARD_MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;

export interface ForwardPayload {
  messageType: 'text' | 'image' | 'video' | 'document' | 'audio';
  contentText: string | null;
  mediaUrl: string | null;
  filename: string | null;
}

export type ForwardBlockReason =
  | 'no_content'
  | 'media_unavailable'
  | 'unsupported';

export interface ForwardPlan {
  payload?: ForwardPayload;
  reason?: ForwardBlockReason;
}

function isHttpUrl(value: string | null | undefined): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

/**
 * Build the re-send payload for a stored message.
 *
 * Media is re-sent by its durable `chat-media` URL — the same envelope
 * the composer uploads for an outbound attachment, and the mirror the
 * webhook writes for inbound media. A message whose media URL is a Meta
 * media id (or a signed URL that has expired) cannot be forwarded; the
 * UI says so instead of sending a broken attachment.
 */
export interface ForwardSource {
  content_type: Message['content_type'];
  /** Nullable on purpose: DB rows predating a column read back as null. */
  content_text?: string | null;
  media_url?: string | null;
  template_name?: string | null;
}

export function forwardPayloadFor(message: ForwardSource): ForwardPlan {
  const text = (message.content_text ?? '').trim();
  const kind = message.content_type;

  if ((FORWARD_MEDIA_KINDS as readonly string[]).includes(kind)) {
    if (!isHttpUrl(message.media_url)) return { reason: 'media_unavailable' };
    return {
      payload: {
        messageType: kind as ForwardPayload['messageType'],
        // Audio carries no caption per Meta's spec; the others do.
        contentText: kind === 'audio' ? null : text || null,
        mediaUrl: message.media_url,
        filename: kind === 'document' ? basenameFromUrl(message.media_url) : null,
      },
    };
  }

  // Templates, interactive sends and plain text all forward as their
  // rendered body: the recipient gets the text they should have seen,
  // not a half-replayable template reference.
  if (!text) return { reason: kind === 'location' ? 'unsupported' : 'no_content' };
  return {
    payload: { messageType: 'text', contentText: text, mediaUrl: null, filename: null },
  };
}

/** Trim a requested target list to a safe, de-duplicated set. */
export function normalizeForwardTargets(
  ids: readonly (string | null | undefined)[] | null | undefined
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= FORWARD_TARGET_MAX) break;
  }
  return out;
}
