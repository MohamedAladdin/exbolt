/**
 * Which push endpoints may we send to?
 *
 * `web-push` POSTs the encrypted payload to whatever URL is stored in
 * `push_subscriptions.endpoint`. That URL arrives from a browser, i.e. from data we
 * do not control — so an unvalidated endpoint is a server-side request forgery
 * primitive: a tenant could store `https://internal-host/admin` and have the
 * dashboard box call it with a signed request.
 *
 * Two gates, both required:
 *   1. `https:` only (a push endpoint is never plain http).
 *   2. the host must be one of the real push services, matched on a label
 *      boundary — `evil-fcm.googleapis.com.attacker.tld` must not pass, which is
 *      why the check is `host === allowed || host.endsWith("." + allowed)` and never
 *      `includes`.
 *
 * The same function runs at subscribe time (reject early, tell the user) and again
 * just before sending (defence in depth: a row written by hand or by an older build
 * must not be trusted).
 */

/** Hosts the four browser families actually use, as of 2026. */
export const ALLOWED_PUSH_HOSTS = [
  // Chrome / Edge / Opera / Brave / Samsung (FCM legacy + current)
  "fcm.googleapis.com",
  "android.googleapis.com",
  // Firefox
  "push.services.mozilla.com",
  // Edge legacy / Windows Notification Service
  "notify.windows.com",
  // Safari (macOS 13+ / iOS 16.4+ installed web app)
  "web.push.apple.com",
] as const;

/** A push endpoint URL is long but not unbounded. 2 KB is generous. */
export const MAX_ENDPOINT_LENGTH = 2048;

/** Base64url only — the key blobs are binary, encoded. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface NormalizedSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function isAllowedPushEndpoint(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  return ALLOWED_PUSH_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/**
 * `p256dh` is an uncompressed P-256 point (65 bytes → 87/88 base64url chars) and
 * `auth` is a 16-byte secret (22 chars). The ranges are wide on purpose: encoders
 * differ on padding, and a too-tight bound would reject a legitimate device.
 */
export function isPlausibleP256dh(value: unknown): boolean {
  return typeof value === "string" && value.length >= 80 && value.length <= 120 && BASE64URL.test(value);
}

export function isPlausibleAuthSecret(value: unknown): boolean {
  return typeof value === "string" && value.length >= 16 && value.length <= 32 && BASE64URL.test(value);
}

/**
 * Turn a browser `PushSubscription.toJSON()` body into what we store, or null.
 * Never throws: this is fed straight from a request body.
 */
export function normalizeSubscription(input: unknown): NormalizedSubscription | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown } | null;
  };

  if (!isAllowedPushEndpoint(raw.endpoint)) return null;
  const p256dh = raw.keys?.p256dh;
  const auth = raw.keys?.auth;
  if (!isPlausibleP256dh(p256dh) || !isPlausibleAuthSecret(auth)) return null;

  return {
    endpoint: raw.endpoint as string,
    p256dh: p256dh as string,
    auth: auth as string,
  };
}

/** Which push service a subscription belongs to — for the devices list label. */
export function pushServiceName(endpoint: string): string {
  const host = (() => {
    try {
      return new URL(endpoint).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host.includes("google")) return "Chrome / Edge";
  if (host.includes("mozilla")) return "Firefox";
  if (host.includes("windows")) return "Edge (WNS)";
  if (host.includes("apple")) return "Safari";
  return "Browser";
}
