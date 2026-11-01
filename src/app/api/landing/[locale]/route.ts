// ============================================================
// GET /api/landing/[locale] — the marketing page with live plan cards.
//
// The page itself stays static (`public/landing/*.html`) so its design, fonts
// and animations never pass through React; only the pricing grid is rendered
// from `plans` and spliced in. That is the one section that must never drift
// from what the product actually enforces.
//
// Failure mode is deliberate: if the database is unreachable or the anchors
// moved, the untouched static file is served. A stale price beats a blank
// landing page.
// ============================================================

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { getLandingContent, type LandingLocale } from '@/lib/landing/content';
import { injectPlanCards, renderPricingGrid } from '@/lib/landing/plans-html';

export const dynamic = 'force-dynamic';

const LOCALES: LandingLocale[] = ['ar', 'en'];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  const safeLocale: LandingLocale = LOCALES.includes(locale as LandingLocale)
    ? (locale as LandingLocale)
    : 'ar';

  const file = path.join(process.cwd(), 'public', 'landing', `${safeLocale}.html`);
  let html: string;
  try {
    html = await readFile(file, 'utf8');
  } catch (err) {
    console.error('[landing] could not read the static page:', err);
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const content = await getLandingContent(safeLocale);
    const cards = renderPricingGrid(content.plans, safeLocale);
    const injected = injectPlanCards(html, cards);
    if (!injected.injected) {
      console.warn('[landing] pricing anchors not found — serving the static page untouched');
    }
    return new NextResponse(injected.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Caching is owned by `headers()` in next.config.ts (one rule for `/`,
        // `/ar`, `/en`); setting it here too would just fight that rule.
        Vary: 'Cookie',
      },
    });
  } catch (err) {
    console.error('[landing] plan render failed, serving the static page:', err);
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
