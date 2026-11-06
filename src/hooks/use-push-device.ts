"use client";

/**
 * This device's push state, as the browser reports it.
 *
 * The truth is the browser — permission plus a live `pushManager` subscription —
 * never a saved flag, because a device the user blocked in site settings must not
 * look "on". Two surfaces show this switch (Settings → الإشعارات and the notifications
 * page's quick card), and both must agree: enabling from the first-run prompt, from
 * another tab or here all dispatch `PUSH_CHANGE_EVENT`, and `focus` /
 * `visibilitychange` cover the cross-tab case (a subscription lives in the browser,
 * so `storage` events cannot carry it).
 */

import { useCallback, useEffect, useState } from "react";

import {
  PUSH_CHANGE_EVENT,
  currentLocale,
  currentPermission,
  disablePush,
  enablePush,
  getExistingSubscription,
  pushSupported,
  type PushFailure,
  type PushPermissionState,
} from "@/hooks/use-push";

export interface PushDevice {
  supported: boolean;
  permission: PushPermissionState;
  subscribed: boolean;
  /** True while the browser prompt / subscribe round-trip is running. */
  busy: boolean;
  /** `null` on success, otherwise the reason this device is still not enabled. */
  toggle: (next: boolean) => Promise<PushFailure | null>;
}

export function usePushDevice(): PushDevice {
  const [permission, setPermission] = useState<PushPermissionState>("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setPermission(currentPermission());
    setSubscribed(Boolean(await getExistingSubscription()));
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(PUSH_CHANGE_EVENT, onChange);
    window.addEventListener("focus", onChange);
    document.addEventListener("visibilitychange", onChange);
    return () => {
      window.removeEventListener(PUSH_CHANGE_EVENT, onChange);
      window.removeEventListener("focus", onChange);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, [refresh]);

  const toggle = useCallback(
    async (next: boolean) => {
      setBusy(true);
      try {
        const result = next ? await enablePush(currentLocale()) : await disablePush();
        await refresh();
        return result.ok ? null : (result.reason ?? "network");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return {
    supported: pushSupported(),
    permission,
    subscribed,
    busy,
    toggle,
  };
}
