/**
 * POST /api/public/inquiries — landing-page lead capture.
 *
 * Public and unauthenticated by design. Defences, in order:
 *   1. origin allow-list (the marketing site is a separate static host),
 *   2. per-IP rate limit (10 submissions / hour, in-memory),
 *   3. honeypot field + server-side validation,
 *   4. service-role insert into a table with RLS and no policies.
 *
 * Nothing is echoed back except the new id, so the endpoint cannot be used to
 * enumerate existing rows.
 */

import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/admin/db';
import { validateInquiry } from '@/lib/inquiries/validate';
import { corsHeaders, isAllowedOrigin } from '@/lib/public/origins';

export const dynamic = 'force-dynamic';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_PER_WINDOW;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);

  if (!isAllowedOrigin(origin)) {
    return NextResponse.json({ error: 'origin_not_allowed' }, { status: 403 });
  }

  if (rateLimited(clientIp(request))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers });
  }

  const body = await request.json().catch(() => null);
  const result = validateInquiry(body);
  if (!result.ok) {
    if (result.error === 'honeypot') {
      // Pretend success; never write a row.
      return NextResponse.json({ ok: true }, { status: 201, headers });
    }
    return NextResponse.json(
      { error: result.error, field: result.field },
      { status: 400, headers }
    );
  }

  const { data, error } = await adminDb()
    .from('inquiries')
    .insert({
      name: result.value.name,
      company: result.value.company,
      email: result.value.email,
      phone: result.value.phone,
      team_size: result.value.teamSize,
      plan: result.value.plan,
      message: result.value.message,
      locale: result.value.locale,
      source: result.value.source,
      page: result.value.page,
    })
    .select('id')
    .single();

  if (error) {
    console.error('inquiry_insert_failed', error.message);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500, headers });
  }

  return NextResponse.json({ ok: true, id: data.id }, { status: 201, headers });
}
