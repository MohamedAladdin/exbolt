/**
 * The transport: one encrypted POST per device.
 *
 * Everything about *what* to send and *to whom* lives elsewhere (payload builders in
 * P3, the outbox drain in P3, the settings UI in P2/P5). This module answers one
 * question — "did the push service accept this?" — and classifies the answer so the
 * caller can act on it:
 *
 *   ok           2xx — accepted, the device should display it
 *   gone         404/410 — the subscription is dead, delete the row
 *   retry        429 / 5xx / network / timeout — try again later
 *   failed       400/401/403/413 — our request is wrong; retrying changes nothing
 *   blocked      endpoint not on the push-service allowlist (SSRF guard)
 *   unconfigured VAPID keys are missing — nothing can be sent, and saying so is
 *                better than a silent no-op
 *
 * It never throws: the callers are request handlers and cron runs whose real job
 * must continue even when one device is unreachable.
 */

import webpush, { WebPushError } from "web-push";

import { isAllowedPushEndpoint, type NormalizedSubscription } from "./endpoint";
import { fitPushPayload, type PushContent } from "./payload";

/** A push to a phone that has been asleep for a day is not worth waking it for. */
export const PUSH_TTL_SECONDS = 3_600;

/** Hard ceiling per device, so one dead endpoint cannot hold a request open. */
export const PUSH_TIMEOUT_MS = 5_000;

export type PushOutcome = "ok" | "gone" | "retry" | "failed" | "blocked" | "unconfigured";

export interface PushDelivery {
  outcome: PushOutcome;
  /** Push-service status code when there was one. */
  status?: number;
  /** Where the failure came from — for logs and the failing-device label. */
  detail?: string;
}

export type PushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; timeout: number; topic?: string; urgency?: "very-low" | "low" | "normal" | "high" },
) => Promise<{ statusCode: number }>;

export function vapidPublicKey(): string | null {
  const key = process.env.VAPID_PUBLIC_KEY?.trim();
  return key ? key : null;
}

/** All three env keys present, or push is simply off (no crash, no half state). */
export function isPushConfigured(): boolean {
  return Boolean(
    vapidPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim() && process.env.VAPID_SUBJECT?.trim(),
  );
}

let vapidReady = false;

function ensureVapid(): boolean {
  if (vapidReady) return true;
  const publicKey = vapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return false;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidReady = true;
    return true;
  } catch {
    // A malformed key pair must not take a route down with it.
    return false;
  }
}

const defaultSender: PushSender = (subscription, payload, options) =>
  webpush.sendNotification(subscription, payload, options);

/** Test seam — the transport is exercised without touching a real push service. */
let sender: PushSender | null = null;
export function setPushSenderForTests(next: PushSender | null): void {
  sender = next;
  vapidReady = false;
}

/**
 * Send one alert to one device.
 *
 * `topic` (≤32 url-safe chars) lets the push service coalesce queued messages for the
 * same conversation when the device is offline — the last alert of a burst wins
 * instead of five stale banners arriving at once.
 */
export async function sendPush(
  target: Pick<NormalizedSubscription, "endpoint" | "p256dh" | "auth">,
  content: PushContent,
  options: { topic?: string; urgency?: "very-low" | "low" | "normal" | "high" } = {},
): Promise<PushDelivery> {
  if (!isAllowedPushEndpoint(target.endpoint)) {
    return { outcome: "blocked", detail: "endpoint_not_allowed" };
  }
  if (!ensureVapid()) {
    return { outcome: "unconfigured" };
  }

  const payload = JSON.stringify(fitPushPayload(content));
  const send = sender ?? defaultSender;

  try {
    const result = await send(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      payload,
      {
        TTL: PUSH_TTL_SECONDS,
        timeout: PUSH_TIMEOUT_MS,
        topic: options.topic,
        urgency: options.urgency ?? "normal",
      },
    );

    const status = typeof result?.statusCode === "number" ? result.statusCode : 0;
    if (status >= 200 && status < 300) return { outcome: "ok", status };
    if (status === 404 || status === 410) return { outcome: "gone", status };
    if (status === 429 || status >= 500) return { outcome: "retry", status };
    return { outcome: "failed", status, detail: `http_${status}` };
  } catch (err) {
    if (err instanceof WebPushError) {
      const status = err.statusCode ?? 0;
      if (status === 404 || status === 410) return { outcome: "gone", status, detail: err.message };
      if (status === 429 || status >= 500) return { outcome: "retry", status, detail: err.message };
      return { outcome: "failed", status, detail: err.body || err.message };
    }
    // Network error, DNS failure, timeout — the endpoint may be fine later.
    return { outcome: "retry", detail: err instanceof Error ? err.message : String(err) };
  }
}
