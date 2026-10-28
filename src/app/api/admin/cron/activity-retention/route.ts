// ============================================================
// /api/admin/cron/activity-retention — the retention half of the
// activity log.
//
// The trail is append-only by design, so it grows with every settings
// save, template edit and assignment. This endpoint trims anything
// older than RETENTION_DAYS (180) for every account by calling
// `purge_account_activity()` (migration 071). Without a schedule the
// table has no ceiling.
//
// Nothing inside the app is scheduled — an external pinger calls this
// once a day, exactly like the reminders cron:
//
//   curl -H "x-admin-secret: $ADMIN_CRON_SECRET" \
//        https://bolt.excal.uk/api/admin/cron/activity-retention
//
// The secret is the same one the other cron routes use
// (`ADMIN_CRON_SECRET`, falling back to `AUTOMATION_CRON_SECRET`).
// ============================================================

import { NextResponse } from 'next/server';

import { cronAuthorized, cronConfigured } from '@/lib/cron/auth';
import { supabaseAdmin } from '@/lib/automations/admin-client';

/** Long enough for a first large sweep; the route is idempotent. */
export const maxDuration = 60;

/** Product promise: six months of trail, then it ages out. */
export const RETENTION_DAYS = 180;

export async function GET(request: Request) {
  if (!cronConfigured()) {
    // Fail loudly: an unconfigured box must not look like a clean run.
    return NextResponse.json(
      { error: 'cron not configured' },
      { status: 503 },
    );
  }
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin().rpc('purge_account_activity', {
    p_retention_days: RETENTION_DAYS,
  });

  if (error) {
    console.error('[cron] activity retention failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const deleted = typeof data === 'number' ? data : Number(data ?? 0);

  return NextResponse.json({
    deleted,
    retentionDays: RETENTION_DAYS,
    ranAt: new Date().toISOString(),
  });
}
