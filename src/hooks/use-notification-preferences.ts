"use client";

/**
 * Notification preferences — ONE store, every surface.
 *
 * Three screens and two background listeners depend on the same four switches
 * (Settings → الإشعارات, the quick card on /notifications, the profile card, and the
 * alert listeners in the dashboard shell). Reading them per component gave every
 * consumer its own copy fetched at its own mount: switching a type off in Settings
 * left the listener running on the values it read when the page loaded — which is
 * exactly how «قفلت الإشعارات ومازالت بتيجي» happens.
 *
 * So the state lives at module level and every consumer subscribes to it:
 *
 *   - the first subscriber triggers the single load (mounting the shell costs no
 *     request per page);
 *   - `save` is optimistic, then adopts the server's row — the route normalises
 *     fields, and the server's answer wins over our guess;
 *   - a failed write rolls back to the previous snapshot and resolves `false`.
 *
 * The toast on failure stays with the caller — the message is surface-specific.
 */

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_PREFERENCES,
  type NotificationPreferences,
} from "@/lib/push/preferences";

const ENDPOINT = "/api/push/preferences";

export interface NotificationPreferencesState {
  prefs: NotificationPreferences;
  /** True until the first read lands; the switches must not look "off" before it. */
  loading: boolean;
  /** True while a PATCH is in flight — every switch shares the queue. */
  saving: boolean;
}

const INITIAL: NotificationPreferencesState = {
  prefs: DEFAULT_PREFERENCES,
  loading: true,
  saving: false,
};

/** Stable reference for `useSyncExternalStore` during SSR / hydration. */
const SERVER_SNAPSHOT: NotificationPreferencesState = INITIAL;

let state: NotificationPreferencesState = INITIAL;
const listeners = new Set<() => void>();

function emit(next: Partial<NotificationPreferencesState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** Current snapshot — for the dashboard listeners, which are not components. */
export function notificationPrefsSnapshot(): NotificationPreferencesState {
  return state;
}

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

let loadStarted = false;

async function loadOnce(): Promise<void> {
  if (loadStarted) return;
  loadStarted = true;
  const loaded = await requestPreferences();
  // A missing row is not an error: the defaults are the product's opinion. A failed
  // *read* is different — allow the next mount to try again instead of pinning the
  // defaults for the rest of the tab's life.
  if (!loaded) loadStarted = false;
  emit({ prefs: loaded ?? state.prefs, loading: false });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void loadOnce();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Write a patch and adopt the server's row. Resolves `false` when the write
 * failed — the rollback is already applied by then.
 */
export async function saveNotificationPreferences(
  patch: Partial<NotificationPreferences>,
): Promise<boolean> {
  const before = state.prefs;
  emit({ prefs: { ...before, ...patch }, saving: true });
  try {
    const saved = await requestPreferences({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!saved) {
      emit({ prefs: before });
      return false;
    }
    emit({ prefs: saved });
    return true;
  } finally {
    emit({ saving: false });
  }
}

/** Subscribe without a component (module-level listeners). */
export function subscribeNotificationPreferences(listener: () => void): () => void {
  return subscribe(listener);
}

export function useNotificationPreferences(): NotificationPreferencesState & {
  /** Resolves `true` when the server confirmed the write. */
  save: (patch: Partial<NotificationPreferences>) => Promise<boolean>;
} {
  const snapshot = useSyncExternalStore(subscribe, notificationPrefsSnapshot, () => SERVER_SNAPSHOT);
  const save = useCallback(
    (patch: Partial<NotificationPreferences>) => saveNotificationPreferences(patch),
    [],
  );
  return { ...snapshot, save };
}
