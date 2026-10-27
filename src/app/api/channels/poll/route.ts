import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { pollMessagingInbox } from '@/lib/channels/poll-inbox';

/**
 * Pull Messenger/Instagram conversations on a schedule.
 *
 * Why this exists: while the Meta app is in Development Mode, Meta only
 * delivers Page/Instagram webhooks for people with a role on the app. A
 * customer who is not a tester can still message the Page, but nothing reaches
 * ExBolt. This endpoint asks Graph instead, so the inbox keeps working (with
 * the poll interval as latency) until App Review grants advanced access.
 *
 * Auth: `AUTOMATION_CRON_SECRET` via the `x-cron-secret` header — the same
 * convention as `/api/automations/cron` and `/api/flows/cron`, so operators
 * provision one secret, not three.
 *
 * Schedule: every 2 minutes from `/etc/cron.d/exbolt-cron`. Idempotent by
 * message id, so it is safe to run alongside real webhooks.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }

  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  try {
    const result = await pollMessagingInbox();
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - started,
      ...result,
    });
  } catch (err) {
    console.error('[channels/poll] failed:', err);
    return NextResponse.json({ ok: false, error: 'poll failed' }, { status: 500 });
  }
}
