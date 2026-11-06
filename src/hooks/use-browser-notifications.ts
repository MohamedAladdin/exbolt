"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types";
import {
  clearLegacyBrowserNotifyPref,
  getNotificationPermission,
  readLegacyBrowserNotifyPref,
  shouldNotifyForMessage,
  viewedConversationFromLocation,
} from "@/lib/notifications/browser-notify";
import { desktopAlertAllowed } from "@/lib/notifications/gate";
import {
  playNotificationChime,
  readSoundPref,
  subscribeSoundPref,
} from "@/lib/notifications/sound";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";
import { usePushDevice } from "@/hooks/use-push-device";
import {
  currentLocale,
  enablePush,
  getExistingSubscription,
  pushSupported,
} from "@/hooks/use-push";

/**
 * Device-scoped "play a sound" preference (default on).
 */
export function useNotificationSoundPref(): boolean {
  return useSyncExternalStore(subscribeSoundPref, readSoundPref, () => true);
}

/**
 * The sound that belongs to a new inbound customer message.
 *
 * This hook used to draw its own desktop banner with `new Notification(...)`, which
 * meant two things: the banner ignored every switch in Settings (it obeyed a
 * localStorage flag and the browser's permission, nothing else), and once Web Push
 * was enabled the same message could raise two banners. The OS banner now comes
 * from the service worker only — the single path the device switch can turn off —
 * and this hook contributes exactly the part a push payload cannot carry: the
 * product's own chime.
 *
 * When a dashboard tab is open the worker shows the banner silently (a tab means
 * the operator is here), so this is the only sound that rings. With no tab open the
 * OS plays its own. Both cases are gated by the same preferences:
 * `desktopAlertAllowed(...)` — out-of-app channel, the customer-message type, quiet
 * hours and this device's subscription.
 *
 * Mount ONCE per signed-in dashboard tab (<BrowserNotificationsListener />).
 * Listens for realtime INSERTs on `messages`; RLS scopes the stream to the caller's
 * account. No initial fetch: an existing backlog never rings on page load.
 */
export function useBrowserNotifications(): void {
  const { prefs, loading } = useNotificationPreferences();
  const device = usePushDevice();
  const soundOn = useNotificationSoundPref();

  // Message ids already handled, for replay dedupe. Pruned by shouldNotifyForMessage.
  const seenRef = useRef<Map<string, number>>(new Map());

  // Read inside the realtime callback, assigned in an effect so a re-render does not
  // tear down and re-open the channel.
  const stateRef = useRef({ prefs, deviceSubscribed: device.subscribed, soundOn });
  useEffect(() => {
    stateRef.current = { prefs, deviceSubscribed: device.subscribed, soundOn };
  });

  /**
   * One-time migration: a device that had the old localStorage opt-in on gets a real
   * push subscription instead of silently losing its alerts. The browser already
   * holds the permission, so this subscribes without a prompt.
   */
  useEffect(() => {
    if (!pushSupported()) return;
    if (!readLegacyBrowserNotifyPref()) return;
    if (getNotificationPermission() !== "granted") return;

    let cancelled = false;
    void (async () => {
      const existing = await getExistingSubscription();
      if (cancelled) return;
      if (!existing) await enablePush(currentLocale());
      if (cancelled) return;
      clearLegacyBrowserNotifyPref();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Wait for the server's switches: the defaults are "on", and chiming before the
    // real answer lands would ring for a tenant who turned alerts off.
    if (loading) return;

    const supabase = createClient();
    const channel = supabase
      .channel("browser-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          const eligible = shouldNotifyForMessage(msg, {
            documentVisible: document.visibilityState === "visible",
            viewingConversationId: viewedConversationFromLocation(
              window.location.pathname,
              window.location.search,
            ),
            seen: seenRef.current,
          });
          if (!eligible) return;

          const current = stateRef.current;
          // Re-read permission every time: the user can revoke it in the browser
          // without any of our switches flipping.
          const allowed = desktopAlertAllowed(
            {
              prefs: current.prefs,
              permission: getNotificationPermission(),
              deviceSubscribed: current.deviceSubscribed,
            },
            "customer_message",
          );
          if (!allowed) return;
          if (!current.soundOn) return;
          playNotificationChime();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loading]);
}
