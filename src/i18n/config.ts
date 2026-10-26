/**
 * Locale configuration shared by the server (next-intl), the layout and
 * the settings UI.
 *
 * The active locale is a *runtime* choice stored in a cookie, not a build
 * variable. Upstream resolves the catalogue at build time from
 * `NEXT_PUBLIC_APP_LOCALE`; that cannot satisfy "switch the UI to Arabic
 * from Settings", so the cookie wins and the env var is only the default
 * for a first visit (and what `@app-messages` — the server-side
 * translator used by API routes — still resolves against).
 */

export const LOCALES = ['ar', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/** Fallback when neither the cookie nor the env var names a locale. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Cookie holding the user's choice. Read server-side by src/i18n/request.ts. */
export const LOCALE_COOKIE = 'exbolt_locale';

/** Locales written right-to-left. */
export const RTL_LOCALES: readonly Locale[] = ['ar'];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** `dir` attribute for a locale. */
export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return isLocale(locale) && RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

/** Native name of each locale, for the language picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ar: 'العربية',
  en: 'English',
};

/**
 * Resolve the locale to render: cookie → env default → English. Pure so
 * the same rule is testable and can be reused outside next-intl.
 */
export function resolveLocale(
  cookieValue: string | null | undefined,
  envValue: string | null | undefined,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (isLocale(envValue)) return envValue;
  return DEFAULT_LOCALE;
}
