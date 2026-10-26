import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { LOCALE_COOKIE, LOCALES, isLocale } from '@/i18n/config';

/**
 * Persist the UI language choice.
 *
 * The active locale is read server-side on every request (see
 * `src/i18n/request.ts`), so switching language is a cookie write followed
 * by a client-side `router.refresh()` — no reload, no per-user DB column,
 * and it works before the user signs in (the login screen is translated
 * too).
 *
 * One year, `lax`, path-wide: this is a preference, not a credential.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const locale = body?.locale;

  if (!isLocale(locale)) {
    return NextResponse.json(
      { error: `locale must be one of: ${LOCALES.join(', ')}` },
      { status: 400 },
    );
  }

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  return NextResponse.json({ ok: true, locale });
}

export async function GET() {
  const store = await cookies();
  const current = store.get(LOCALE_COOKIE)?.value ?? null;
  return NextResponse.json({ locale: current, available: LOCALES });
}
