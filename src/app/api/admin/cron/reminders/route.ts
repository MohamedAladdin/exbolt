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
import { cronAuthorized } from '@/lib/cron/auth';

export const maxDuration = 60;

export async function GET(request: Request) {
  // Shared with the activity-retention cron; constant-time compare lives
  // in the helper (this endpoint sends mail).
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await runReminders(null);
  return NextResponse.json(result);
}
