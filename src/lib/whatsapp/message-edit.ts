// ============================================================
// Edit eligibility for an inbox message.
//
// WhatsApp's Cloud API exposes NO edit endpoint (nor a delete/revoke
// one) — the feature is still an open request on Meta's developer
// community. So "edit" has exactly two honest shapes:
//
//   in_place   — the message never reached the recipient (status
//                `failed`). Nothing was delivered, so replacing the
//                row's text and re-sending it IS an edit, and the
//                thread does not grow a duplicate bubble.
//
//   correction — anything that already arrived (sent/delivered/read).
//                The only truthful action is a new message quoting the
//                original, and the original is stamped `edited_at` +
//                `correction_message_id`.
//
//   blocked    — inbound messages. An agent cannot edit what the
//                customer wrote, and rewriting it would corrupt the
//                conversation record.
//
// Kept pure so the dialog, the route and the tests all agree on the
// same rule.
// ============================================================

import type { Message } from '@/types';

export const EDIT_TEXT_MAX = 4096;

export type EditMode = 'in_place' | 'correction' | 'blocked';

export type EditBlockReason = 'inbound' | 'empty' | 'too_long';

/**
 * Which edit path applies to a message. Deliberately reads only the
 * three fields that decide it, so callers can pass a partial row.
 */
export function editModeFor(
  message: Pick<Message, 'sender_type' | 'status' | 'content_type'>
): EditMode {
  if (message.sender_type === 'customer') return 'blocked';
  // Only a failed send can be replaced in place: it never reached the
  // recipient, so the row is ours to rewrite. (`sending` rows are
  // optimistic client-side placeholders — no row exists to update.)
  if (message.status === 'failed' && message.content_type === 'text') {
    return 'in_place';
  }
  return 'correction';
}

export interface NormalizedEdit {
  text: string | null;
  reason?: EditBlockReason;
}

/** Trim, collapse nothing else, and enforce Meta's 4096-char text cap. */
export function normalizeEditText(
  raw: string | null | undefined,
  max: number = EDIT_TEXT_MAX
): NormalizedEdit {
  const text = (raw ?? '').trim();
  if (!text) return { text: null, reason: 'empty' };
  if (text.length > max) return { text: null, reason: 'too_long' };
  return { text };
}

/**
 * The correction prefix. It ships in the customer's chat, so it follows
 * the agent's UI language — and the dialog previews the final text
 * before sending, so nothing lands unseen.
 */
export function buildCorrectionText(text: string, locale: string): string {
  const prefix = locale.startsWith('ar') ? 'تصحيح لما سبق' : 'Correction';
  return `${prefix}: ${text}`.slice(0, EDIT_TEXT_MAX);
}

/** True when the row should render an "edited" marker. */
export function isEdited(
  message: Pick<Message, 'edited_at' | 'correction_message_id'>
): boolean {
  return Boolean(message.edited_at || message.correction_message_id);
}
