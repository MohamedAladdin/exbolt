/**
 * WhatsApp 24-hour customer-service window, as the composer must see it.
 *
 * Meta rejects a free-form message when the customer has not written in the
 * last 24 hours (`131047 re-engagement`). That is a property of the
 * conversation, not of whatever messages happen to be paginated into the
 * thread — and a thread with NO inbound at all is closed too, because a
 * customer who never wrote has never opened the window.
 *
 * Deriving it from the loaded messages alone meant an empty thread answered
 * "not expired", so the composer stayed enabled on a brand-new chat and the
 * greeting bounced at Meta. 114 of the 121 `131047` failures on prod
 * (2026-10-31) were exactly that: the first message in the thread.
 *
 * Both sources are merged (latest wins) because the parent's
 * `conversation.last_inbound_at` can lag behind the realtime message insert;
 * taking the max keeps the composer from locking on a customer who just wrote.
 */

export const SESSION_WINDOW_HOURS = 24;

const MS_PER_HOUR = 3_600_000;

export type SessionWindowReason = "open" | "closed" | "never";

export type SessionWindow = {
  expired: boolean;
  /** Hours left in the window; always 0 once it is closed. */
  hoursLeft: number;
  /** `never` = the customer has not written even once. */
  reason: SessionWindowReason;
};

type SenderType = "customer" | "agent" | string;

export function sessionWindow(input: {
  lastInboundAt?: string | null;
  messages?: { sender_type: SenderType; created_at: string }[];
  now?: Date;
}): SessionWindow {
  const now = input.now ?? new Date();
  let latest = parseDate(input.lastInboundAt);

  for (const message of input.messages ?? []) {
    if (message.sender_type !== "customer") continue;
    const at = parseDate(message.created_at);
    if (at && (!latest || at.getTime() > latest.getTime())) latest = at;
  }

  if (!latest) return { expired: true, hoursLeft: 0, reason: "never" };

  const hoursSince = (now.getTime() - latest.getTime()) / MS_PER_HOUR;
  if (hoursSince >= SESSION_WINDOW_HOURS) {
    return { expired: true, hoursLeft: 0, reason: "closed" };
  }

  return {
    expired: false,
    hoursLeft: SESSION_WINDOW_HOURS - hoursSince,
    reason: "open",
  };
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
