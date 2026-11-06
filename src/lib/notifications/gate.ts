/**
 * Who is allowed to be disturbed — ONE decision for every alert surface.
 *
 * The notification settings had three consumers and only one of them (Web Push,
 * server-side) read the preferences: the in-page desktop alert listened to a
 * per-device localStorage flag, and the `notifications` popup asked the browser
 * for permission and nothing else. So an operator could switch every type off in
 * Settings and still get banners — reported as «الإشعارات لا تنطفئ».
 *
 * Every surface now decides through this module:
 *
 *   - `inAppAlertAllowed`  → the sonner card inside the app;
 *   - `desktopAlertAllowed` → anything that appears outside the app (the service
 *     worker banner, the chime that accompanies it).
 *
 * The device switch is `deviceSubscribed`: one live push subscription per device,
 * the only thing that can actually be turned off from a browser. Pure + React-free
 * so the rules are unit-tested instead of argued about in a bug report.
 */

import { isWithinQuietHours, type NotificationPreferences } from "@/lib/push/preferences";

/** The four switches the operator sees, and nothing else. */
export type AlertType =
  | "customer_message"
  | "conversation_assigned"
  | "ai_handoff"
  | "report_alert";

/**
 * A `notifications.type` row → the switch that owns it.
 *
 * The table keeps its own vocabulary (`ai_handoff_unassigned`) because four
 * producers write it; the switch is the operator's word (`ai_handoff`). Mapping
 * here means a new row type either gets a gate or is visibly ungated.
 */
export function alertTypeForRow(type: string): AlertType | null {
  switch (type) {
    case "conversation_assigned":
      return "conversation_assigned";
    case "ai_handoff_unassigned":
      return "ai_handoff";
    case "report_alert":
      return "report_alert";
    default:
      return null;
  }
}

export interface AlertContext {
  prefs: NotificationPreferences;
  /** `Notification.permission`, or `unsupported` where the API is missing. */
  permission: NotificationPermission | "unsupported";
  /** This device holds a live push subscription — the single device switch. */
  deviceSubscribed: boolean;
  /** Injectable clock for tests. */
  now?: Date;
}

/** Quiet hours are the operator's "do not disturb", on every surface. */
export function isQuietNow(prefs: NotificationPreferences, now: Date = new Date()): boolean {
  return isWithinQuietHours(prefs, now);
}

/**
 * The in-app card.
 *
 * Gated on `in_app_alerts` (the channel) and the type switch — the panel's own
 * promise: switching «رسالة عميل جديدة» off stops the popup too, not just the
 * phone. Quiet hours apply here as well; a card is still an interruption.
 */
export function inAppAlertAllowed(
  prefs: NotificationPreferences,
  type: AlertType,
  now?: Date,
): boolean {
  if (prefs.in_app_alerts !== true) return false;
  if (prefs[type] !== true) return false;
  return !isQuietNow(prefs, now);
}

/**
 * Anything that leaves the app: the service-worker banner and the chime that
 * goes with it.
 *
 * Four independent gates, all of them the operator's own switches — the channel
 * (`push_enabled`), the type, quiet hours, and this device's subscription. A
 * missing browser permission or a device with no subscription cannot receive
 * anything, so it reports false rather than pretending to deliver.
 */
export function desktopAlertAllowed(ctx: AlertContext, type: AlertType): boolean {
  if (ctx.prefs.push_enabled !== true) return false;
  if (ctx.prefs[type] !== true) return false;
  if (isQuietNow(ctx.prefs, ctx.now)) return false;
  if (ctx.permission !== "granted") return false;
  return ctx.deviceSubscribed;
}
