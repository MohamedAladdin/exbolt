/**
 * When to ask an employee to turn notifications on.
 *
 * The ask has to exist — otherwise the push channel is built and nobody enables it —
 * but it must never become nagging, and it must never pop a browser permission
 * dialog on page load (Chrome ignores or "quiet-blocks" an unprompted request, and
 * the block is what the user is then stuck with).
 *
 * So the rule is a small state machine over three facts: what the browser allows,
 * whether this device is already subscribed, and how many times the bar has been
 * dismissed (device-scoped, in localStorage).
 *
 * Pure so the rules are testable without a browser.
 */

export const PROMPT_DISMISSALS_KEY = "exbolt:push-prompt-dismissals";
export const PROMPT_DISMISSED_AT_KEY = "exbolt:push-prompt-dismissed-at";

/** Come back once after two weeks; after the second dismissal, never again. */
export const PROMPT_REMIND_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
export const PROMPT_MAX_DISMISSALS = 2;

export type PromptPermission = "unsupported" | "denied" | "default" | "granted";

export type PromptVariant = "enable" | "denied";

export interface PromptDecision {
  show: boolean;
  /** `enable` = offer the button; `denied` = explain the lock icon, no button. */
  variant: PromptVariant | null;
  reason:
    | "unsupported"
    | "already_subscribed"
    | "dismissed_recently"
    | "dismissed_for_good"
    | "permission_denied"
    | "permission_default"
    | "permission_granted_not_subscribed";
}

export function shouldShowPushPrompt(args: {
  permission: PromptPermission;
  subscribed: boolean;
  dismissals: number;
  dismissedAt: number | null;
  now?: number;
}): PromptDecision {
  const { permission, subscribed } = args;
  const dismissals = Number.isFinite(args.dismissals) ? Math.max(0, args.dismissals) : 0;
  const now = args.now ?? Date.now();

  if (permission === "unsupported") {
    return { show: false, variant: null, reason: "unsupported" };
  }

  // Denied is permanent in the browser: explain once, then never again.
  if (permission === "denied") {
    if (dismissals >= 1) {
      return { show: false, variant: null, reason: "dismissed_for_good" };
    }
    return { show: true, variant: "denied", reason: "permission_denied" };
  }

  if (subscribed) {
    return { show: false, variant: null, reason: "already_subscribed" };
  }

  if (dismissals >= PROMPT_MAX_DISMISSALS) {
    return { show: false, variant: null, reason: "dismissed_for_good" };
  }

  // First ask is immediate; every later one waits out the reminder window.
  if (dismissals > 0 && args.dismissedAt) {
    if (now - args.dismissedAt < PROMPT_REMIND_AFTER_MS) {
      return { show: false, variant: null, reason: "dismissed_recently" };
    }
  }

  return {
    show: true,
    variant: "enable",
    reason:
      permission === "granted" ? "permission_granted_not_subscribed" : "permission_default",
  };
}

/** Device-scoped dismissal bookkeeping. Never throws in private mode. */
export function readPromptDismissals(): { dismissals: number; dismissedAt: number | null } {
  if (typeof window === "undefined") return { dismissals: 0, dismissedAt: null };
  try {
    const dismissals = Number(window.localStorage.getItem(PROMPT_DISMISSALS_KEY) ?? "0");
    const dismissedAt = Number(window.localStorage.getItem(PROMPT_DISMISSED_AT_KEY) ?? "0");
    return {
      dismissals: Number.isFinite(dismissals) ? dismissals : 0,
      dismissedAt: dismissedAt > 0 ? dismissedAt : null,
    };
  } catch {
    return { dismissals: 0, dismissedAt: null };
  }
}

export function recordPromptDismissal(now = Date.now()): void {
  if (typeof window === "undefined") return;
  const current = readPromptDismissals();
  try {
    window.localStorage.setItem(PROMPT_DISMISSALS_KEY, String(current.dismissals + 1));
    window.localStorage.setItem(PROMPT_DISMISSED_AT_KEY, String(now));
  } catch {
    // Private mode: the bar may come back next load. Acceptable.
  }
}
