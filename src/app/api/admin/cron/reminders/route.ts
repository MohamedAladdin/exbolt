/**
 * /api/admin/cron/reminders — the scheduled half of the reminder system.
 *
 * Nothing inside the app is scheduled (same constraint as the automation
 * and flow crons), so an external pinger calls this once a day:
 *
 *   curl -H "x-admin-secret: $ADMIN_CRON_SECRET" \
 *        https://bolt.excal.uk/api/admin/cron/reminders
 *
 * Falls back to AUTOMATION_CRON_SECRET when no dedicated secret is set —
 * one less env var to provision on the box.
 */

import { NextResponse } from 'next/server';

import { runReminders } from '@/lib/admin/mutations';

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret =
    process.env.ADMIN_CRON_SECRET || process.env.AUTOMATION_CRON_SECRET;
  if (!secret) return false;
  const provided =
    request.headers.get('x-admin-secret') ??
    request.headers.get('x-cron-secret') ??
    new URL(request.url).searchParams.get('secret');
  if (!provided || provided.length !== secret.length) return false;
  // Constant-time compare: this endpoint sends mail.
  let diff = 0;
  for (let i = 0; i < secret.length; i += 1) {
    diff |= secret.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await runReminders(null);
  return NextResponse.json(result);
}
