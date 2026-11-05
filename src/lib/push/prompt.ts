/**
 * When to ask an employee to turn notifications on.
 *
 * The ask has to exist — otherwise the push channel is built and nobody enables it —
 * but it must never become nagging, and it must never pop a browser permission
 * dialog on page load (Chrome ignores or "quiet-blocks" an unprompted request, and
 * the block is what the user is then stuck with).
 *
 * The owner of the product asked for the opposite of a one-time nudge: while this
 * device is NOT receiving alerts, the bar stays. A device with notifications off is
 * a device where a customer waits for a reply nobody hears about, so the reminder is
 * persistent — «ليس الآن» hides it for the current session only (sessionStorage),
 * not for two weeks and certainly not forever.
 *
 * Pure so the rules are testable without a browser.
 */

/** Session-scoped: the bar returns on the next sign-in, by design. */
export const PROMPT_SESSION_KEY = "exbolt:push-prompt-hidden";

export type PromptPermission = "unsupported" | "denied" | "default" | "granted";

export type PromptVariant = "enable" | "denied";

export interface PromptDecision {
  show: boolean;
  /** `enable` = offer the button; `denied` = explain the lock icon, no button. */
  variant: PromptVariant | null;
  reason:
    | "unsupported"
    | "already_subscribed"
    | "hidden_this_session"
    | "permission_denied"
    | "permission_default"
    | "permission_granted_not_subscribed";
}

export function shouldShowPushPrompt(args: {
  permission: PromptPermission;
  subscribed: boolean;
  /** True when the user pressed «ليس الآن» in THIS session. */
  hiddenThisSession?: boolean;
}): PromptDecision {
  const { permission, subscribed } = args;

  if (permission === "unsupported") {
    return { show: false, variant: null, reason: "unsupported" };
  }

  if (subscribed) {
    return { show: false, variant: null, reason: "already_subscribed" };
  }

  // Hidden for this session only — every new sign-in asks again, which is what
  // "keep reminding them while it is off" means in practice.
  if (args.hiddenThisSession) {
    return { show: false, variant: null, reason: "hidden_this_session" };
  }

  // Denied cannot be fixed from the page, so the bar explains the lock icon
  // instead of offering a button that would fail.
  if (permission === "denied") {
    return { show: true, variant: "denied", reason: "permission_denied" };
  }

  return {
    show: true,
    variant: "enable",
    reason:
      permission === "granted" ? "permission_granted_not_subscribed" : "permission_default",
  };
}

/** Session-scoped bookkeeping. Never throws in private mode. */
export function isPromptHiddenThisSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PROMPT_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function hidePromptForSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PROMPT_SESSION_KEY, "1");
  } catch {
    // Private mode: the bar may reappear on the next render. Acceptable.
  }
}

/** Clears the session flag — called after a successful enable. */
export function clearPromptSessionHide(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PROMPT_SESSION_KEY);
  } catch {
    // ignore
  }
}
