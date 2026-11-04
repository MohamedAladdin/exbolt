/**
 * Automatic thread state, as the sweep job must decide it.
 *
 * The inbox has three statuses and only two of them are the agent's to set:
 * `open` is the normal working state, `pending` means "the 24h window is gone,
 * a template is the only way back", and `closed` means "this thread is done".
 * Leaving both of those to a human does not survive a hundred dead threads a
 * week, so a cron derives them from the metrics every thread already carries.
 *
 * The rules are conservative on purpose — every guard here is a thread the job
 * refuses to retire:
 *
 *   • `unread_count > 0` — the agent has not even read the customer's message.
 *   • waiting on us (`last_inbound_at` newer than `last_reply_at`) — that is a
 *     dropped lead, not an idle thread; auto-closing it hides the work.
 *   • no inbound at all — a brand-new, business-initiated thread. It stays
 *     `open`; the composer already knows the window never opened (it reads
 *     `sessionWindow().reason === 'never'`), so the status does not need to lie
 *     about it, and a thread that was just created must not read "معلّقة"
 *     seconds after the agent sent its first template.
 *
 * `closed` is checked first because its threshold is the looser one: a thread
 * idle past the threshold is closed, not pending.
 */

import { SESSION_WINDOW_HOURS } from "./session-window";

export const DEFAULT_AUTO_CLOSE_DAYS = 7;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export type AutoStatusTarget = "pending" | "closed" | null;

export type SweepCandidate = {
  status: "open" | "pending" | "closed";
  last_inbound_at?: string | null;
  last_message_at?: string | null;
  last_reply_at?: string | null;
  unread_count?: number | null;
};

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The customer wrote last and nobody answered yet. Mirrors `isAwaitingReply`. */
export function isWaitingOnUs(row: SweepCandidate): boolean {
  const inbound = parseDate(row.last_inbound_at);
  if (!inbound) return false;
  const reply = parseDate(row.last_reply_at);
  if (!reply) return true;
  return reply.getTime() < inbound.getTime();
}

/**
 * What the sweep should set this thread to, or `null` to leave it alone.
 */
export function autoStatusFor(
  row: SweepCandidate,
  options: { now?: number; closeAfterDays?: number } = {},
): AutoStatusTarget {
  if (row.status === "closed") return null;
  if ((row.unread_count ?? 0) > 0) return null;
  if (isWaitingOnUs(row)) return null;

  const now = options.now ?? Date.now();
  const closeAfterDays =
    Number.isFinite(options.closeAfterDays) && (options.closeAfterDays ?? 0) > 0
      ? (options.closeAfterDays as number)
      : DEFAULT_AUTO_CLOSE_DAYS;

  // Thresholds count from the last message on either side — not from
  // `updated_at`, which any metadata write would reset.
  const lastMessage = parseDate(row.last_message_at);
  if (lastMessage && now - lastMessage.getTime() >= closeAfterDays * MS_PER_DAY) {
    return "closed";
  }

  if (row.status === "open") {
    const inbound = parseDate(row.last_inbound_at);
    if (inbound && now - inbound.getTime() >= SESSION_WINDOW_HOURS * MS_PER_HOUR) {
      return "pending";
    }
  }

  return null;
}

/** Clamp an account's stored threshold into the range the job will honour. */
export function normaliseCloseAfterDays(value: unknown): number {
  // `null`/`''` mean "not set", not zero — Number(null) is 0 and would clamp
  // every account without a value down to a single day.
  if (value === null || value === undefined || value === "") {
    return DEFAULT_AUTO_CLOSE_DAYS;
  }
  const days = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(days)) return DEFAULT_AUTO_CLOSE_DAYS;
  const rounded = Math.round(days);
  if (rounded < 1) return 1;
  if (rounded > 90) return 90;
  return rounded;
}
