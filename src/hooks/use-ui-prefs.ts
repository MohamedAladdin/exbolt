"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  ARABIC_FONT_STORAGE_KEY,
  DEFAULT_ARABIC_FONT,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_STORAGE_KEY,
  isArabicFont,
  isFontSize,
  type ArabicFont,
  type FontSize,
} from "@/lib/ui-prefs";

/**
 * UI typography preferences — Arabic font family + global type scale.
 *
 * Same contract as the theme hook: the boot script in `layout.tsx` already
 * applied both to `<html>` before hydration (`data-arabic-font`,
 * `data-font-size`), so the DOM is the source of truth and this hook only
 * mirrors it. Every change is a single attribute swap — instant, no reload,
 * no server round-trip.
 *
 * The DOM is read through `useSyncExternalStore` rather than copied into
 * state from an effect: the server snapshot is the default, so the markup
 * the server sent still matches on hydration, and a change made anywhere on
 * the page re-renders every consumer of the same attribute.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify every consumer after an attribute swap (also picks up the change
 *  in the component that made it — the store, not local state, is the truth). */
function emit() {
  for (const listener of listeners) listener();
}

function readArabicFont(): ArabicFont {
  const attr = document.documentElement.dataset.arabicFont;
  return isArabicFont(attr) ? attr : DEFAULT_ARABIC_FONT;
}

function readFontSize(): FontSize {
  const attr = document.documentElement.dataset.fontSize;
  return isFontSize(attr) ? attr : DEFAULT_FONT_SIZE;
}

const serverArabicFont = () => DEFAULT_ARABIC_FONT;
const serverFontSize = () => DEFAULT_FONT_SIZE;

export function useUiPrefs() {
  const arabicFont = useSyncExternalStore(
    subscribe,
    readArabicFont,
    serverArabicFont,
  );
  const fontSize = useSyncExternalStore(
    subscribe,
    readFontSize,
    serverFontSize,
  );

  const setArabicFont = useCallback((next: ArabicFont) => {
    document.documentElement.dataset.arabicFont = next;
    try {
      localStorage.setItem(ARABIC_FONT_STORAGE_KEY, next);
    } catch {
      // Preferences are best-effort; a sandboxed context just loses them.
    }
    emit();
  }, []);

  const setFontSize = useCallback((next: FontSize) => {
    document.documentElement.dataset.fontSize = next;
    try {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, next);
    } catch {
      // As above.
    }
    emit();
  }, []);

  return { arabicFont, setArabicFont, fontSize, setFontSize };
}
