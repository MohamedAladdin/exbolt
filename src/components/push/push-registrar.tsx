"use client";

import { useEffect } from "react";

import { currentLocale, currentPermission, refreshSubscription, registerServiceWorker } from "@/hooks/use-push";

/** Once per tab session is enough for a sync that only exists to repair drift. */
const SYNC_FLAG = "exbolt:push-synced";

/**
 * Headless. Mounted once per signed-in dashboard tab, beside the other alert
 * listeners.
 *
 * Two jobs, both silent:
 *   1. Register `/sw.js` so the browser has a push target even before the user
 *      enables anything (a subscription needs a registration to attach to).
 *   2. If permission was granted in an earlier session, re-save the existing
 *      subscription once — the VAPID keys or the row may have changed while the
 *      user was away, and a stale endpoint is a notification that never arrives.
 *
 * It never asks for permission: that happens on a click, in the settings screen or
 * the first-run prompt, and nowhere else.
 */
export function PushRegistrar() {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const registration = await registerServiceWorker();
      if (cancelled || !registration) return;
      if (currentPermission() !== "granted") return;

      try {
        if (window.sessionStorage.getItem(SYNC_FLAG) === "1") return;
        window.sessionStorage.setItem(SYNC_FLAG, "1");
      } catch {
        // Private mode: syncing on each load is acceptable.
      }

      await refreshSubscription(currentLocale());
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
