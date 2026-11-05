/**
 * What a push says — and what it must never say.
 *
 * Rendering lives at SEND time, not enqueue time, for three reasons:
 *   1. the user's privacy level can change while a row waits in the outbox;
 *   2. the device's locale is known per subscription, so one alert can go out
 *      in Arabic to the phone and English to the laptop;
 *   3. a burst on one thread replaces the row's `preview`, and the newest text
 *      must be the one that ships.
 *
 * The privacy default is `name`: a lock screen that shows «رسالة من أحمد» is
 * useful on a shared desk, «عايز أعرف سعر الكشف» is not.
 */

import type { PushContent, PushLocale } from "./payload";

export type PushKind =
  | "customer_message"
  | "conversation_assigned"
  | "ai_handoff"
  | "report_alert";

export type PushPreview = "none" | "name" | "full";

interface KindCopy {
  /** Title when the contact is unknown or the preview level hides it. */
  title: string;
  /** Body for the `name` level. `{name}` is replaced with the contact name. */
  body: string;
}

const COPY: Record<PushLocale, Record<PushKind, KindCopy> & { open: string; unknown: string }> = {
  ar: {
    customer_message: { title: "رسالة جديدة", body: "رسالة من {name}" },
    conversation_assigned: { title: "اتسندتلك محادثة جديدة", body: "{name}" },
    ai_handoff: { title: "المساعد الآلي محتاج تدخّل بشري", body: "{name} مستني رد" },
    report_alert: { title: "تنبيه من التقرير", body: "افتح النظام لمراجعة الأرقام" },
    open: "افتح النظام للتفاصيل",
    unknown: "عميل",
  },
  en: {
    customer_message: { title: "New message", body: "Message from {name}" },
    conversation_assigned: { title: "A conversation was assigned to you", body: "{name}" },
    ai_handoff: { title: "The assistant needs a human", body: "{name} is waiting" },
    report_alert: { title: "Report alert", body: "Open the dashboard for the numbers" },
    open: "Open the dashboard for details",
    unknown: "A customer",
  },
};

export function kindCopy(locale: PushLocale, kind: PushKind): KindCopy {
  return COPY[locale]?.[kind] ?? COPY.ar[kind];
}

export function copyFor(locale: PushLocale): { open: string; unknown: string } {
  const dict = COPY[locale] ?? COPY.ar;
  return { open: dict.open, unknown: dict.unknown };
}

export interface PushRenderInput {
  kind: PushKind;
  contactName: string | null;
  /** Raw text of the newest event on the thread (already in the sender's words). */
  preview: string | null;
  url: string | null;
  /** Notification identity, so a newer alert replaces the banner instead of stacking. */
  tag: string;
}

const BODY_MAX = 110;

function clamp(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= BODY_MAX) return flat;
  const cut = flat.slice(0, BODY_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > BODY_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Turn one outbox row into the bytes for one device.
 *
 * `preview` is the privacy switch:
 *   none → no contact name, no text (title only);
 *   name → the contact's name, never the message;
 *   full → the name plus the message text.
 */
export function renderPush(
  input: PushRenderInput,
  locale: PushLocale,
  preview: PushPreview = "name",
): PushContent {
  const copy = kindCopy(locale, input.kind);
  const generic = copyFor(locale);
  const name = input.contactName?.trim() || generic.unknown;

  let title = copy.title;
  let body = copy.body.replace("{name}", name);

  if (input.kind === "customer_message") {
    if (preview === "none") {
      title = copy.title;
      body = generic.open;
    } else if (preview === "full") {
      title = name;
      body = clamp(input.preview ?? "") || generic.open;
    } else {
      title = name;
      body = copy.title;
    }
  } else if (preview === "none") {
    body = generic.open;
  } else if (preview === "full" && input.preview?.trim()) {
    body = clamp(input.preview);
  }

  return {
    title,
    body,
    url: input.url ?? undefined,
    tag: input.tag,
    kind: input.kind,
  };
}

/** "HH:MM" → minutes since midnight, or null when unparseable. */
function toMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Is the account inside its quiet window right now?
 *
 * Both ends are required: one end alone would silence a team from midnight
 * until it is cleared, which is exactly the bug the preferences validator
 * refuses to store. A window like 22:00→07:00 wraps midnight.
 */
export function isQuietNow(
  quietFrom: string | null | undefined,
  quietTo: string | null | undefined,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  const from = toMinutes(quietFrom);
  const to = toMinutes(quietTo);
  if (from === null || to === null || from === to) return false;

  let localNow: string;
  try {
    localNow = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    return false;
  }
  const minutes = toMinutes(localNow);
  if (minutes === null) return false;

  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}
