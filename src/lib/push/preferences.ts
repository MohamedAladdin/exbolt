/**
 * Notification preferences — the shape and the validation rules.
 *
 * The danger in a PATCH endpoint is not the happy path; it is a client that sends
 * `{"push_enabled": "false"}` (a string), `{"customer_message": 0}`, or a quiet-hour
 * pair where only one end arrived. Stored as-is, those become a switch that reads
 * "on" while behaving "off", or a suppression window of NULL → midnight that
 * silences a team overnight. So every field is normalized explicitly and anything
 * unrecognized is dropped rather than stored.
 *
 * Pure and React-free so the rules are unit-tested without a route or a database.
 */

export const PUSH_PREVIEW_MODES = ["none", "name", "full"] as const;
export type PushPreview = (typeof PUSH_PREVIEW_MODES)[number];

export const CHANNEL_KEYS = ["in_app_alerts", "push_enabled"] as const;
export const TYPE_KEYS = [
  "customer_message",
  "conversation_assigned",
  "ai_handoff",
  "report_alert",
] as const;

export type ChannelKey = (typeof CHANNEL_KEYS)[number];
export type TypeKey = (typeof TYPE_KEYS)[number];

export interface NotificationPreferences {
  in_app_alerts: boolean;
  push_enabled: boolean;
  customer_message: boolean;
  conversation_assigned: boolean;
  ai_handoff: boolean;
  report_alert: boolean;
  push_preview: PushPreview;
  /** "HH:MM" or null. Both ends are required together. */
  quiet_from: string | null;
  quiet_to: string | null;
}

/** Everything on, name-only preview, no quiet hours. */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  in_app_alerts: true,
  push_enabled: true,
  customer_message: true,
  conversation_assigned: true,
  ai_handoff: true,
  report_alert: true,
  push_preview: "name",
  quiet_from: null,
  quiet_to: null,
};

export interface PreferencePatchResult {
  patch: Partial<NotificationPreferences>;
  /** Field names that were sent but rejected — the API answers 400 with these. */
  invalid: string[];
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidQuietTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

/**
 * Normalize a PATCH body.
 *
 * - Unknown keys are ignored (forward compatibility: an older build must not 400 a
 *   newer client that sends `quiet_hours_enabled`).
 * - A wrongly-typed *known* key is `invalid` — silently ignoring it would leave the
 *   UI showing a state the server does not hold.
 * - Quiet hours must be set as a pair or cleared as a pair.
 */
export function normalizePreferencePatch(input: unknown): PreferencePatchResult {
  const patch: Partial<NotificationPreferences> = {};
  const invalid: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { patch, invalid: ["body"] };
  }
  const raw = input as Record<string, unknown>;

  for (const key of [...CHANNEL_KEYS, ...TYPE_KEYS]) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== "boolean") {
      invalid.push(key);
      continue;
    }
    patch[key] = value;
  }

  if ("push_preview" in raw) {
    const value = raw.push_preview;
    if (typeof value === "string" && (PUSH_PREVIEW_MODES as readonly string[]).includes(value)) {
      patch.push_preview = value as PushPreview;
    } else {
      invalid.push("push_preview");
    }
  }

  const touchedQuiet = "quiet_from" in raw || "quiet_to" in raw;
  if (touchedQuiet) {
    const from = raw.quiet_from ?? null;
    const to = raw.quiet_to ?? null;
    const fromOk = from === null || isValidQuietTime(from);
    const toOk = to === null || isValidQuietTime(to);

    if (!fromOk) invalid.push("quiet_from");
    if (!toOk) invalid.push("quiet_to");

    // Half a window is not a window: 22:00 → NULL would otherwise mean "silent from
    // 22:00 until midnight" depending on how a consumer reads it.
    const bothSet = isValidQuietTime(from) && isValidQuietTime(to);
    const bothCleared = from === null && to === null;
    if (fromOk && toOk && !bothSet && !bothCleared) {
      invalid.push("quiet_range");
    } else {
      patch.quiet_from = fromOk ? (from as string | null) : null;
      patch.quiet_to = toOk ? (to as string | null) : null;
    }
  }

  return { patch, invalid: [...new Set(invalid)] };
}

/** Is `now` inside the quiet window? Handles a window that wraps midnight. */
export function isWithinQuietHours(
  prefs: Pick<NotificationPreferences, "quiet_from" | "quiet_to">,
  now: Date,
): boolean {
  const { quiet_from: from, quiet_to: to } = prefs;
  if (!from || !to) return false;
  if (from === to) return false; // a zero-length window is "off", not "all day"

  const minutes = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  const start = fh * 60 + fm;
  const end = th * 60 + tm;

  // 22:00 → 08:00 wraps; 09:00 → 17:00 does not.
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

/** Row → preferences, with defaults for anything a older row lacks. */
export function preferencesFromRow(row: Record<string, unknown> | null): NotificationPreferences {
  if (!row) return { ...DEFAULT_PREFERENCES };
  const pick = <K extends keyof NotificationPreferences>(key: K): NotificationPreferences[K] => {
    const value = row[key as string];
    return (value === undefined || value === null ? DEFAULT_PREFERENCES[key] : value) as NotificationPreferences[K];
  };
  return {
    in_app_alerts: pick("in_app_alerts"),
    push_enabled: pick("push_enabled"),
    customer_message: pick("customer_message"),
    conversation_assigned: pick("conversation_assigned"),
    ai_handoff: pick("ai_handoff"),
    report_alert: pick("report_alert"),
    push_preview: pick("push_preview"),
    quiet_from: (row.quiet_from as string | null) ?? null,
    quiet_to: (row.quiet_to as string | null) ?? null,
  };
}
