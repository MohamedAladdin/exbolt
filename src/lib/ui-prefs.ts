/**
 * Device-scoped UI typography preferences (language-adjacent, stored the
 * same way as the theme: localStorage, replayed by a boot script before
 * first paint so there is no flash).
 *
 * Why device-scoped and not per-account: font family and size are
 * legibility/eyesight choices, like theme and unlike anything shared with
 * teammates. The language, by contrast, IS account-relevant enough to be
 * worth a cookie (it changes the copy everyone else may be reading over
 * your shoulder) — see src/i18n/config.ts.
 */

export const ARABIC_FONTS = ['cairo', 'tajawal', 'kufi'] as const;
export type ArabicFont = (typeof ARABIC_FONTS)[number];

export const FONT_SIZES = ['sm', 'md', 'lg', 'xl'] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const ARABIC_FONT_STORAGE_KEY = 'exbolt:ui:arabic-font';
export const FONT_SIZE_STORAGE_KEY = 'exbolt:ui:font-size';

export const DEFAULT_ARABIC_FONT: ArabicFont = 'cairo';
export const DEFAULT_FONT_SIZE: FontSize = 'md';

/** Root font-size per step — Tailwind's rem scale does the rest.
 *  `md` keeps the browser default (16px), so a user who never opens
 *  Settings sees exactly the upstream layout. */
export const FONT_SIZE_PX: Record<FontSize, number> = {
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
};

export const ARABIC_FONT_LABELS: Record<ArabicFont, string> = {
  cairo: 'Cairo',
  tajawal: 'Tajawal',
  kufi: 'Noto Kufi Arabic',
};

export function isArabicFont(value: unknown): value is ArabicFont {
  return typeof value === 'string' && (ARABIC_FONTS as readonly string[]).includes(value);
}

export function isFontSize(value: unknown): value is FontSize {
  return typeof value === 'string' && (FONT_SIZES as readonly string[]).includes(value);
}

/** CSS custom property each family maps to (set up in layout.tsx). */
export const ARABIC_FONT_VAR: Record<ArabicFont, string> = {
  cairo: 'var(--font-arabic-cairo)',
  tajawal: 'var(--font-arabic-tajawal)',
  kufi: 'var(--font-arabic-kufi)',
};
