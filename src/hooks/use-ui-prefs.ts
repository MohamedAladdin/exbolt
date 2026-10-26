"use client";

import { useCallback, useEffect, useState } from "react";

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
 * `data-font-size`), so this hook only reads what is there and keeps it in
 * sync afterwards. Every change is a single attribute swap — instant, no
 * reload, no server round-trip.
 */
export function useUiPrefs() {
  const [arabicFont, setArabicFontState] = useState<ArabicFont>(DEFAULT_ARABIC_FONT);
  const [fontSize, setFontSizeState] = useState<FontSize>(DEFAULT_FONT_SIZE);

  useEffect(() => {
    const root = document.documentElement;
    const fontAttr = root.dataset.arabicFont;
    if (isArabicFont(fontAttr)) setArabicFontState(fontAttr);
    const sizeAttr = root.dataset.fontSize;
    if (isFontSize(sizeAttr)) setFontSizeState(sizeAttr);
  }, []);

  const setArabicFont = useCallback((next: ArabicFont) => {
    setArabicFontState(next);
    document.documentElement.dataset.arabicFont = next;
    try {
      localStorage.setItem(ARABIC_FONT_STORAGE_KEY, next);
    } catch {
      // Preferences are best-effort; a sandboxed context just loses them.
    }
  }, []);

  const setFontSize = useCallback((next: FontSize) => {
    setFontSizeState(next);
    document.documentElement.dataset.fontSize = next;
    try {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, next);
    } catch {
      // As above.
    }
  }, []);

  return { arabicFont, setArabicFont, fontSize, setFontSize };
}
