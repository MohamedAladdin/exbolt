// ============================================================
// Activity log — shared vocabulary (pure, no I/O, no React).
//
// The database does the recording (migration 070, one trigger per
// audited table); this module is the single place that turns a raw
// `account_activity_log` row into something a human can read:
// which category it belongs to, which translation key to use, and
// how a changed value should be rendered.
//
// Keeping it pure means the same rules are unit-tested here, used
// by `GET /api/account/activity`, and used by the settings panel —
// there is no second interpretation of an event anywhere.
// ============================================================

/** Grouping used by the UI filter chips and by the icon per row. */
export type ActivityCategory =
  | "members"
  | "settings"
  | "integrations"
  | "content"
  | "automations"
  | "inbox";

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  "members",
  "settings",
  "integrations",
  "content",
  "automations",
  "inbox",
] as const;

/** `app` = a signed-in person; `system` = cron/webhook/flow engine. */
export type ActivitySource = "app" | "system";

export interface ActivityChange {
  from: unknown;
  to: unknown;
}

/** A row as it comes back from PostgREST (snake_case, unchanged). */
export interface ActivityEvent {
  id: number;
  created_at: string;
  action: string;
  category: ActivityCategory;
  source: ActivitySource;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  changes: Record<string, ActivityChange>;
  metadata: Record<string, unknown>;
}

export interface ActivityActor {
  id: string | null;
  name: string | null;
  email: string | null;
  events: number;
}

export function isActivityCategory(value: unknown): value is ActivityCategory {
  return (
    typeof value === "string" &&
    (ACTIVITY_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * `settings.whatsapp_updated` → `actions.settings_whatsapp_updated`.
 *
 * Flat keys on purpose: next-intl reads dots as nesting, and the
 * database owns the dotted action name, so mapping it here keeps the
 * message catalogue one level deep and diff-friendly.
 */
export function actionKey(action: string): string {
  return `actions.${action.replace(/[^a-z0-9]+/gi, "_")}`;
}

/** Column name → catalogue key under `fields`. */
export function fieldKey(column: string): string {
  return `fields.${column}`;
}

export type ValueKind =
  | "empty"
  | "secret"
  | "boolean"
  | "role"
  | "list"
  | "json"
  | "id"
  | "text";

const ROLES = ["owner", "admin", "agent", "viewer"] as const;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What the DB writes in place of a token/secret: ••• or ***. */
const SECRET_RE = /^[•*·]{3,}$/;

/**
 * How a single side of a diff should be drawn. The database already
 * masks secrets as `•••`, so a masked value is recognised by shape
 * rather than by re-deriving the column list here.
 */
export function valueKind(value: unknown): ValueKind {
  if (value === null || value === undefined || value === "") return "empty";
  if (SECRET_RE.test(String(value))) return "secret";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") {
    if ((ROLES as readonly string[]).includes(value)) return "role";
    if (UUID_RE.test(value)) return "id";
    return "text";
  }
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "json";
  return "text";
}

const UUID_PREFIX = 8;

/** Collapse a value to a short, single-line preview. */
export function previewValue(value: unknown, max = 80): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (typeof value === "object") {
    const json = JSON.stringify(value);
    return json.length > max ? `${json.slice(0, max - 1)}…` : json;
  }
  const text = String(value);
  if (UUID_RE.test(text)) return text.slice(0, UUID_PREFIX);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Local calendar day of an event, as `YYYY-MM-DD`. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Newest-first groups, each tagged with its day so the UI can head it. */
export function groupByDay(
  events: ActivityEvent[],
): { day: string; events: ActivityEvent[] }[] {
  const groups: { day: string; events: ActivityEvent[] }[] = [];
  for (const event of events) {
    const day = dayKey(event.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(event);
    else groups.push({ day, events: [event] });
  }
  return groups;
}

/**
 * Rows carry one diff entry per changed column; showing five of them
 * inline turns a log into a wall. Keep the first `limit` and report
 * how many are folded away.
 */
export function visibleChanges(
  changes: Record<string, ActivityChange> | null | undefined,
  limit = 3,
): { entries: [string, ActivityChange][]; hidden: number } {
  const all = Object.entries(changes ?? {});
  return { entries: all.slice(0, limit), hidden: Math.max(0, all.length - limit) };
}

/** True when the event is worth calling out as destructive in the UI. */
export function isDestructive(action: string): boolean {
  return /(removed|deleted|disconnected|revoked|removed_from)/.test(action);
}
