/**
 * GET /api/public/landing?locale=ar — pricing + contact copy for the static
 * landing page. Read-only, cache-free (an admin edit should show immediately),
 * and origin-restricted to the marketing host.
 */

import { NextResponse } from 'next/server';

import { getLandingContent, type LandingLocale } from '@/lib/landing/content';
import { corsHeaders, isAllowedOrigin } from '@/lib/public/origins';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  const headers = {
    ...corsHeaders(origin),
    'Cache-Control': 'no-store, max-age=0',
  };

  if (!isAllowedOrigin(origin)) {
    return NextResponse.json({ error: 'origin_not_allowed' }, { status: 403 });
  }

  const requested = new URL(request.url).searchParams.get('locale');
  const locale: LandingLocale = requested === 'en' ? 'en' : 'ar';

  try {
    const content = await getLandingContent(locale);
    return NextResponse.json(content, { headers });
  } catch (error) {
    console.error('[landing] content read failed:', error);
    return NextResponse.json({ error: 'content_unavailable' }, { status: 500, headers });
  }
}
