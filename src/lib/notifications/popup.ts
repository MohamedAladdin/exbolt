import type { Notification } from "@/types";

/**
 * Rules for the in-app notification popup.
 *
 * The `notifications` table is written by three producers (the assignment
 * trigger, the AI handoff alert, the reports cron) and consumed by two
 * surfaces: the `/notifications` list and — since this module — a popup that
 * appears the moment a row lands. Neither surface invents a notification:
 * both read the same rows, so a new producer needs one type entry here and
 * one translation, nothing else.
 *
 * Kept free of React and browser globals so the decisions are unit-testable
 * in the node vitest env.
 */

/** Types the product knows how to render. Mirrors the table's CHECK constraint. */
export const POPUP_TYPES = [
  "conversation_assigned",
  "ai_handoff_unassigned",
  "report_alert",
] as const;

export type PopupType = (typeof POPUP_TYPES)[number];

export function isPopupType(type: string): type is PopupType {
  return (POPUP_TYPES as readonly string[]).includes(type);
}

/** Translation key for a type's title, or null when the type is unknown. */
export function typeLabelKey(type: string): PopupType | null {
  return isPopupType(type) ? type : null;
}

/**
 * The English sentence the handoff alert appends to its body
 * (`src/lib/ai/handoff-alert.ts`). The popup carries its own "open"
 * action, so the hint is redundant noise — and it is the one part of the
 * body that is pure boilerplate rather than customer content.
 */
const BODY_HINT_SUFFIXES = [
  " Pick it up in the inbox.",
  "Pick it up in the inbox.",
] as const;

/**
 * Notification body as the popup should show it: trimmed, with the
 * boilerplate handoff hint removed. Stored text is otherwise shown verbatim
 * (it carries the agent name and the customer's own words).
 */
export function popupBody(body: string | null | undefined): string {
  const raw = (body ?? "").trim();
  if (!raw) return "";
  for (const suffix of BODY_HINT_SUFFIXES) {
    if (raw.endsWith(suffix)) return raw.slice(0, -suffix.length).trim();
  }
  return raw;
}

/** Where a popup's action button goes. */
export function popupHref(
  row: Pick<Notification, "conversation_id">,
): string {
  return row.conversation_id
    ? `/inbox?c=${encodeURIComponent(row.conversation_id)}`
    : "/notifications";
}

/**
 * A popup is only *visible* if something is on screen in front of the user.
 * When the tab is hidden we need a desktop notification instead of an
 * in-page card — and only when the browser has granted permission.
 */
export function shouldShowDesktop(args: {
  documentVisible: boolean;
  permission: NotificationPermission | "unsupported";
}): boolean {
  if (args.documentVisible) return false;
  return args.permission === "granted";
}

/** Cap on the replay-dedupe set, so a long-lived tab cannot grow forever. */
export const SEEN_MAX = 200;

/**
 * Realtime can replay an INSERT after a reconnect, and two tabs each hold
 * their own listener. Returns true the first time an id is seen.
 */
export function rememberOnce(seen: Set<string>, id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > SEEN_MAX) {
    // Sets keep insertion order: drop the oldest entries.
    const drop = seen.size - SEEN_MAX;
    let removed = 0;
    for (const key of seen) {
      seen.delete(key);
      if (++removed >= drop) break;
    }
  }
  return true;
}
