/**
 * The bytes we hand to `web-push`.
 *
 * A push payload is capped at 4096 bytes by the protocol (the encryption overhead
 * comes out of that budget, so the practical ceiling is ~3.9 KB). Nothing enforces
 * it before the request: an oversized payload comes back as a 413 from the push
 * service, i.e. the alert is simply lost. So every payload is measured and, when
 * needed, trimmed *here* — never by hoping the caller kept it short.
 *
 * Phase P1 only needs the test notification; the per-event builders arrive with the
 * outbox in P3 and reuse `fitPushPayload` / `payloadBytes` from this file.
 */

/** 4096 minus the ~100 bytes aes128gcm adds for header + tag + padding. */
export const MAX_PUSH_PAYLOAD_BYTES = 3_900;

/** How much of the body survives when the payload has to be trimmed. */
export const MIN_BODY_CHARS = 40;

/** Body length cap for the alert copy itself. */
export const BODY_MAX_CHARS = 110;

export type PushLocale = "ar" | "en";

export interface PushContent {
  title: string;
  body: string;
  /** Where a click should land, absolute path inside the app. */
  url?: string;
  /**
   * Notification identity. Thread-scoped alerts use `conv:<conversation_id>` so a
   * newer alert replaces the old banner instead of stacking; everything else uses
   * the outbox id.
   */
  tag?: string;
  /** `customer_message` · `conversation_assigned` · `ai_handoff_unassigned` · `report_alert` · `test`. */
  kind?: string;
}

export function payloadBytes(content: PushContent): number {
  return Buffer.byteLength(JSON.stringify(content), "utf8");
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const hard = collapsed.slice(0, max);
  const lastSpace = hard.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? hard.slice(0, lastSpace) : hard;
  return `${cut.trimEnd()}…`;
}

/**
 * Fit a payload under the protocol limit. Titles are never dropped (a notification
 * with an empty title renders as «ExBolt» and says nothing); the body is what gets
 * shortened, then removed, then the optional url/tag are dropped — in that order,
 * because a too-long url is not a reason to lose the alert.
 */
export function fitPushPayload(
  content: PushContent,
  maxBytes = MAX_PUSH_PAYLOAD_BYTES,
): PushContent {
  const fitted: PushContent = {
    ...content,
    body: truncate(content.body, BODY_MAX_CHARS),
  };
  if (payloadBytes(fitted) <= maxBytes) return fitted;

  // Shrink the body before touching anything else.
  let body = fitted.body;
  while (body.length > MIN_BODY_CHARS && payloadBytes({ ...fitted, body }) > maxBytes) {
    body = truncate(body, Math.max(MIN_BODY_CHARS, body.length - 20));
  }
  fitted.body = body;
  if (payloadBytes(fitted) <= maxBytes) return fitted;

  // Last resort: the alert matters, the deep link and the identity do not.
  const minimal: PushContent = { title: fitted.title, body: "", kind: fitted.kind };
  return minimal;
}

const TEST_COPY: Record<PushLocale, { title: string; body: string }> = {
  ar: {
    title: "الإشعارات شغالة ✅",
    body: "هذا اختبار. أي رسالة أو إسناد جديد هيوصلك على الجهاز ده حتى لو النظام مقفول.",
  },
  en: {
    title: "Notifications are working ✅",
    body: "This is a test. New messages and assignments will reach this device even with the app closed.",
  },
};

/** The `إرسال إشعار تجريبي` button: proves the whole transport, not just the DB row. */
export function buildTestPayload(locale: PushLocale): PushContent {
  const copy = TEST_COPY[locale] ?? TEST_COPY.ar;
  return fitPushPayload({
    ...copy,
    url: "/settings?tab=notifications",
    tag: "exbolt-test",
    kind: "test",
  });
}
