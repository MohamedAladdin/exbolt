"use client";

/**
 * Web Push from the browser's side.
 *
 * The only module that talks to `serviceWorker` / `pushManager` / `Notification`
 * permission, so the rules stay in one place:
 *
 *   - registering the worker is free and silent (no permission prompt) — it happens
 *     on every dashboard visit through <PushRegistrar />;
 *   - asking for permission happens **only** inside a click handler (the enable
 *     switch or the first-run prompt); Chrome ignores or "quiet-blocks" a
 *     permission request that no gesture asked for, and a blocked site cannot be
 *     un-blocked from the page;
 *   - the subscription is stored server-side through `/api/push/subscribe`, which
 *     validates the endpoint and binds it to the session — never to a body field.
 *
 * Failures come back as a `reason` the UI can explain instead of a thrown error,
 * because "الإشعارات مش شغالة" with no cause is the report we are trying to avoid.
 */

export type PushPermissionState = "unsupported" | "denied" | "default" | "granted";

export type PushLocale = "ar" | "en";

export type PushFailure =
  | "unsupported"
  | "denied"
  | "not_configured"
  | "too_many_devices"
  | "no_device"
  | "network"
  | "save_failed"
  | "subscribe_failed";

export interface PushResult {
  ok: boolean;
  reason?: PushFailure;
  sent?: number;
}

/** `localStorage`-free: state that matters lives in the browser + the server. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function currentPermission(): PushPermissionState {
  if (!pushSupported()) return "unsupported";
  return window.Notification.permission as PushPermissionState;
}

/** The browser's locale for the payload — the app's own choice, not the OS's. */
export function currentLocale(): PushLocale {
  if (typeof document === "undefined") return "ar";
  return document.documentElement.lang === "en" ? "en" : "ar";
}

/**
 * Register (or find) the worker. `updateViaCache: 'none'` so a new sw.js is fetched
 * on load instead of being served from the HTTP cache for up to 24 h.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  } catch {
    return null;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** VAPID public key as bytes for `applicationServerKey`. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // A plain ArrayBuffer, not ArrayBufferLike: `applicationServerKey` is typed as
  // BufferSource and rejects a view over SharedArrayBuffer.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function fetchPublicKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid", { credentials: "include" });
    if (!res.ok) return null;
    const body = (await res.json()) as { publicKey?: string };
    return body.publicKey ?? null;
  } catch {
    return null;
  }
}

async function saveSubscription(
  subscription: PushSubscription,
  locale: PushLocale,
): Promise<PushResult> {
  try {
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), locale }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 409) return { ok: false, reason: "too_many_devices" };
    if (res.status === 400) return { ok: false, reason: "subscribe_failed" };
    return { ok: false, reason: "save_failed" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/**
 * Ask, subscribe, save. Must be called from a click handler.
 */
export async function enablePush(locale: PushLocale = currentLocale()): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };

  const permission = await window.Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const publicKey = await fetchPublicKey();
  // 503 from the route: this deployment has no VAPID keys. Say so instead of
  // showing a switch that silently does nothing.
  if (!publicKey) return { ok: false, reason: "not_configured" };

  const registration = await registerServiceWorker();
  if (!registration) return { ok: false, reason: "unsupported" };

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    } catch {
      return { ok: false, reason: "subscribe_failed" };
    }
  }

  return saveSubscription(subscription, locale);
}

export async function disablePush(): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  const subscription = await getExistingSubscription();
  if (!subscription) return { ok: true };

  const endpoint = subscription.endpoint;
  try {
    await subscription.unsubscribe();
  } catch {
    // Even if the browser refuses, the server row must go — otherwise we keep
    // pushing to a device the user asked us to leave alone.
  }

  try {
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** «إرسال إشعار تجريبي» — a real push through the real transport. */
export async function sendTestPush(locale: PushLocale = currentLocale()): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  try {
    const res = await fetch("/api/push/test", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    const body = (await res.json().catch(() => ({}))) as { sent?: number; error?: string };
    if (res.ok) return { ok: Boolean(body.sent), sent: body.sent ?? 0 };
    if (res.status === 503) return { ok: false, reason: "not_configured" };
    if (res.status === 409) return { ok: false, reason: "no_device" };
    return { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/**
 * Keep the server's copy in sync with the browser's when the subscription already
 * exists (keys rotated, locale changed, tenant row lost). Cheap: one POST, only when
 * there is something to say.
 */
export async function refreshSubscription(locale: PushLocale = currentLocale()): Promise<void> {
  if (!pushSupported() || currentPermission() !== "granted") return;
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  await saveSubscription(subscription, locale);
}
