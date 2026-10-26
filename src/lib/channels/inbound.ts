/**
 * Parser for the Messenger / Instagram webhook payloads.
 *
 * Shape (both channels, `object` differs — `page` vs `instagram`):
 *
 * {
 *   object: "page" | "instagram",
 *   entry: [{
 *     id: "<page id | ig business id>",
 *     time: 1712…,
 *     messaging: [{
 *       sender: { id: "<psid | igsid>" },
 *       recipient: { id: "<page id | ig business id>" },
 *       timestamp: 1712…,
 *       message?: {
 *         mid, text?, is_echo?, attachments?: [{type, payload:{url}}]
 *       },
 *       postback?: { mid, title, payload }
 *     }]
 *   }]
 * }
 *
 * Deliberately pure — no DB, no network, no logging — so the money-path
 * parsing is unit-testable against real captured payloads. The DB side
 * lives in `process-inbound.ts`.
 */

import type { MessagingChannel } from './types';
import { channelForWebhookObject } from './types';

export interface InboundAttachment {
  /** Meta attachment type: image | video | audio | file | share | story_mention… */
  type: string;
  url: string | null;
}

export interface MessagingInboundEvent {
  channel: MessagingChannel;
  /** Page id (messenger) or IG business account id (instagram). */
  externalId: string;
  /** PSID / IGSID of the person who wrote — the addressing id. */
  senderId: string;
  /** Meta message id. Used for de-duplication on redelivery. */
  messageId: string | null;
  /** ISO timestamp of the message. */
  createdAt: string;
  text: string | null;
  attachments: InboundAttachment[];
  /** A tap on a quick-reply / button (postback). Rendered as text. */
  isPostback: boolean;
}

interface RawMessagingEntry {
  id?: string;
  time?: number;
  messaging?: RawMessagingItem[];
}

interface RawMessagingItem {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: { type?: string; payload?: { url?: string } }[];
  };
  postback?: { mid?: string; title?: string; payload?: string };
  delivery?: unknown;
  read?: unknown;
  reaction?: unknown;
}

export interface RawMessagingWebhook {
  object?: string;
  entry?: RawMessagingEntry[];
}

function toIso(timestamp: number | undefined): string {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
}

/**
 * Flatten a Meta messaging webhook body into the events we persist.
 *
 * Dropped on purpose:
 *  - `message.is_echo` — the Page's own outbound message echoed back.
 *    Persisting it would duplicate every reply the agent sends.
 *  - `delivery` / `read` / `reaction` items — no message body; status
 *    sync and reactions for these channels are a later phase.
 *  - events with no sender id (Meta system notifications).
 */
export function parseMessagingWebhook(
  body: RawMessagingWebhook,
): MessagingInboundEvent[] {
  const channel = channelForWebhookObject(body.object);
  if (!channel) return [];
  if (!Array.isArray(body.entry)) return [];

  const events: MessagingInboundEvent[] = [];

  for (const entry of body.entry) {
    const externalId = entry.id;
    if (!externalId || !Array.isArray(entry.messaging)) continue;

    for (const item of entry.messaging) {
      const senderId = item.sender?.id;
      if (!senderId) continue;

      const message = item.message;
      if (message?.is_echo) continue;

      const postback = item.postback;
      if (!message && !postback) continue;

      const attachments: InboundAttachment[] = [];
      for (const att of message?.attachments ?? []) {
        attachments.push({
          type: att.type ?? 'file',
          url: att.payload?.url ?? null,
        });
      }

      const text = message?.text?.trim() || postback?.title?.trim() || null;
      // An event with neither text nor a usable attachment (e.g. a
      // deleted-message notice) is not worth a row in the thread.
      if (!text && attachments.length === 0) continue;

      events.push({
        channel,
        externalId,
        senderId,
        messageId: message?.mid ?? postback?.mid ?? null,
        createdAt: toIso(item.timestamp ?? entry.time),
        text,
        attachments,
        isPostback: !message && !!postback,
      });
    }
  }

  return events;
}

/**
 * Map a Meta attachment type onto the app's `messages.content_type`
 * enum. Unknown types fall back to 'document' so the attachment is still
 * downloadable instead of silently vanishing.
 */
export function contentTypeForAttachment(
  type: string,
): 'image' | 'video' | 'audio' | 'document' {
  switch (type) {
    case 'image':
    case 'video':
    case 'audio':
      return type;
    default:
      return 'document';
  }
}
