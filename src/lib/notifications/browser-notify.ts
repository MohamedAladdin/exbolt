import type { ContentType, SenderType } from "@/types";

/**
 * The rules for the in-app half of a new customer message.
 *
 * A desktop alert is NOT built here any more: the OS banner comes from Web Push
 * (the service worker) only, because that is the one path the operator's device
 * switch can actually turn off. What is left is the decision "does this message
 * deserve attention" and the chime that goes with it — kept pure so both are
 * unit-testable in the node vitest env.
 *
 * The hook in `src/hooks/use-browser-notifications.ts` feeds realtime `messages`
 * INSERTs through `shouldNotifyForMessage`.
 */

/**
 * The legacy device opt-in (localStorage, pre-Web-Push). Read only to migrate it:
 * a device that had it on gets subscribed on its next visit instead of silently
 * losing its alerts when the old toggle went away.
 */
export const LEGACY_NOTIFY_STORAGE_KEY = "exbolt:browser-notifications";

/** A duplicate INSERT for the same message id inside this window is ignored. */
export const DEDUPE_WINDOW_MS = 30_000;

/** The subset of `Message` the decision needs. */
export interface NotifiableMessage {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  content_type: ContentType;
  content_text?: string | null;
}

export interface ShouldNotifyOptions {
  /** `document.visibilityState === "visible"` at the time of the event. */
  documentVisible: boolean;
  /** Conversation the user has open in the inbox (`/inbox?c=<id>`), or null. */
  viewingConversationId: string | null;
  /**
   * Recently handled message ids → timestamp. Mutated in place: ids that pass are
   * recorded, stale ones are pruned. Callers keep one Map per listener (a ref) so a
   * replayed INSERT never double-fires.
   */
  seen: Map<string, number>;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * Decide whether an inbound `messages` INSERT deserves attention.
 *
 * - Only customer messages qualify (agent/bot sends are our own).
 * - Skipped when the tab is visible AND the user already has that conversation
 *   open — the thread itself is the alert.
 * - Deduped by message id within DEDUPE_WINDOW_MS (Realtime can replay an event
 *   on reconnect).
 */
export function shouldNotifyForMessage(
  msg: NotifiableMessage,
  opts: ShouldNotifyOptions,
): boolean {
  if (msg.sender_type !== "customer") return false;

  const now = opts.now ?? Date.now();
  for (const [id, at] of opts.seen) {
    if (now - at > DEDUPE_WINDOW_MS) opts.seen.delete(id);
  }
  if (opts.seen.has(msg.id)) return false;
  // Record before the visibility check: a replay of a message we chose to stay
  // silent on must stay silent too.
  opts.seen.set(msg.id, now);

  if (opts.documentVisible && opts.viewingConversationId === msg.conversation_id) {
    return false;
  }
  return true;
}

/**
 * Which conversation the user is looking at, derived from the URL. The inbox
 * mirrors its selection into `/inbox?c=<id>` (router.replace on select), so this
 * needs no shared React state.
 */
export function viewedConversationFromLocation(
  pathname: string,
  search: string,
): string | null {
  if (pathname.replace(/\/+$/, "") !== "/inbox") return null;
  return new URLSearchParams(search).get("c") || null;
}

// ---------------------------------------------------------------------
// Browser-only helpers (SSR-guarded).
// ---------------------------------------------------------------------

export type BrowserNotifyPermission = NotificationPermission | "unsupported";

export function getNotificationPermission(): BrowserNotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return window.Notification.permission;
}

/** Was the old localStorage opt-in on for this device? */
export function readLegacyBrowserNotifyPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LEGACY_NOTIFY_STORAGE_KEY) === "1";
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
    return false;
  }
}

/** Drop the legacy flag once the device has a real subscription. */
export function clearLegacyBrowserNotifyPref(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_NOTIFY_STORAGE_KEY);
  } catch {
    // Best-effort: the flag only matters for the migration itself.
  }
}
