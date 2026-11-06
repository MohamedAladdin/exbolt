"use client";

/**
 * Notification preferences, read and written in one place.
 *
 * Two screens now expose the same switches — Settings → الإشعارات and the quick card
 * on the notifications page — so the fetch, the optimistic write and the rollback
 * live here instead of being copy-pasted. What this hook does NOT own is the toast:
 * the message is surface-specific and translated by the caller.
 *
 * The server's answer wins. `PATCH /api/push/preferences` returns the stored row
 * (defaults filled in), so a save adopts the response rather than the local guess —
 * otherwise a field the route normalised differently would keep showing the guess
 * until the next reload.
 */

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_PREFERENCES,
  type NotificationPreferences,
} from "@/lib/push/preferences";

const ENDPOINT = "/api/push/preferences";

async function requestPreferences(init?: RequestInit): Promise<NotificationPreferences | null> {
  try {
    const res = await fetch(ENDPOINT, { credentials: "include", ...init });
    if (!res.ok) return null;
    const body = (await res.json()) as { preferences?: NotificationPreferences };
    return body.preferences ?? null;
  } catch {
    return null;
  }
}

export function loadNotificationPreferences(): Promise<NotificationPreferences | null> {
  return requestPreferences();
}

export function saveNotificationPreferences(
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferences | null> {
  return requestPreferences({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export interface NotificationPreferencesState {
  prefs: NotificationPreferences;
  /** True until the first read lands; the switches must not look "off" before it. */
  loading: boolean;
  /** True while a PATCH is in flight — every switch shares the queue. */
  saving: boolean;
  /** Resolves `true` when the server confirmed the write. */
  save: (patch: Partial<NotificationPreferences>) => Promise<boolean>;
}

export function useNotificationPreferences(): NotificationPreferencesState {
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadNotificationPreferences();
      if (cancelled) return;
      // A missing row is not an error: the defaults are the product's opinion.
      if (loaded) setPrefs(loaded);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (patch: Partial<NotificationPreferences>) => {
      const before = prefs;
      setPrefs({ ...before, ...patch });
      setSaving(true);
      try {
        const saved = await saveNotificationPreferences(patch);
        if (!saved) {
          setPrefs(before);
          return false;
        }
        setPrefs(saved);
        return true;
      } finally {
        setSaving(false);
      }
    },
    [prefs],
  );

  return { prefs, loading, saving, save };
}
