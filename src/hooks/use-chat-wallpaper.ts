'use client';

import { useCallback, useSyncExternalStore } from 'react';

import {
  CHAT_WALLPAPER_STORAGE_KEY,
  DEFAULT_CHAT_WALLPAPER,
  parseChatWallpaper,
  serializeChatWallpaper,
  type ChatWallpaper,
} from '@/lib/chat-wallpaper';

/**
 * Chat wallpaper preference — one shared, device-scoped store.
 *
 * Two places edit it (Settings → Appearance and the paint button in the
 * thread header) and a third consumes it (the thread canvas). With plain
 * `useState` each consumer would own a private copy: changing the wallpaper
 * from the header popover would leave the canvas behind it unchanged until a
 * reload. So the value lives in a module-level store read through
 * `useSyncExternalStore` — every mounted consumer repaints together, and the
 * cross-tab `storage` event feeds the same path.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Cached snapshot. `null` = not read from the device yet. */
let snapshot: ChatWallpaper | null = null;

function readFromDevice(): ChatWallpaper {
  try {
    return parseChatWallpaper(
      window.localStorage.getItem(CHAT_WALLPAPER_STORAGE_KEY)
    );
  } catch {
    // Private mode / sandboxed iframe: the default look still renders.
    return DEFAULT_CHAT_WALLPAPER;
  }
}

function getSnapshot(): ChatWallpaper {
  if (snapshot === null) snapshot = readFromDevice();
  return snapshot;
}

function getServerSnapshot(): ChatWallpaper {
  // The server has no device to read, and rendering the default here keeps
  // hydration honest: React paints the default first, then swaps to the
  // stored value on the first client pass.
  return DEFAULT_CHAT_WALLPAPER;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(next: ChatWallpaper): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * Persist + broadcast. Returns false when the device refused the write
 * (quota exceeded, or storage disabled) — the UI keeps the new look for this
 * session and tells the user it will not survive a reload.
 */
export function writeChatWallpaper(next: ChatWallpaper): boolean {
  const normalized = parseChatWallpaper(serializeChatWallpaper(next));
  let persisted = true;
  try {
    window.localStorage.setItem(
      CHAT_WALLPAPER_STORAGE_KEY,
      serializeChatWallpaper(normalized)
    );
  } catch {
    persisted = false;
  }
  emit(normalized);
  return persisted;
}

/** Cross-tab sync — a change in tab A repaints tab B. */
export function syncChatWallpaperFromStorage(): void {
  if (typeof window === 'undefined') return;
  emit(readFromDevice());
}

if (
  typeof window !== 'undefined' &&
  typeof window.addEventListener === 'function'
) {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === CHAT_WALLPAPER_STORAGE_KEY) {
      syncChatWallpaperFromStorage();
    }
  });
}

export interface UseChatWallpaper {
  wallpaper: ChatWallpaper;
  /** Merge a patch and persist it. `false` = the device refused to store it. */
  updateWallpaper: (patch: Partial<ChatWallpaper>) => boolean;
  resetWallpaper: () => boolean;
}

export function useChatWallpaper(): UseChatWallpaper {
  const wallpaper = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const updateWallpaper = useCallback((patch: Partial<ChatWallpaper>) => {
    return writeChatWallpaper({ ...getSnapshot(), ...patch });
  }, []);

  const resetWallpaper = useCallback(() => {
    return writeChatWallpaper(DEFAULT_CHAT_WALLPAPER);
  }, []);

  return { wallpaper, updateWallpaper, resetWallpaper };
}
