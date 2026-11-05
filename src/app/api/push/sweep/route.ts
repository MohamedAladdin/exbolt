// ============================================================
// /api/push/sweep — the safety net under the alert pipeline.
//
// One tick, every minute, does three things and reports three numbers:
//
//   1. `reconcile_push_outbox(15 min)` — backfills any event whose trigger
//      swallowed an exception. A non-zero `reconciled` is a bug signal, not a
//      routine repair; the number is in the response so it can be watched.
//   2. `drainPushOutbox()` — claims and sends whatever is pending: rows the
//      webhook's `after()` did not reach, rows whose backoff expired, rows whose
//      claim belonged to a worker that died.
//   3. `purge_push_outbox(30 days)` — a queue is a table; old delivered rows
//      are not history worth keeping.
//
// Guarded by AUTOMATION_CRON_SECRET (`x-cron-secret`), the same convention the
// reports and automations cron routes use. It is idempotent: a double tick
// only loses the claim race, and the counters say so (`lost_race`).
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { drainPushOutbox } from "@/lib/push/dispatch";
import { isPushConfigured } from "@/lib/push/web-push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reconciliation window: wide enough for a slow webhook, narrow enough to be cheap. */
const RECONCILE_WINDOW = "15 minutes";

async function tick() {
  if (!isPushConfigured()) {
    return NextResponse.json({ ok: false, error: "push_not_configured" }, { status: 503 });
  }

  const admin = supabaseAdmin();

  const { data: reconciled, error: reconcileError } = await admin.rpc("reconcile_push_outbox", {
    p_window: RECONCILE_WINDOW,
  });

  const reconciledCount = reconcileError ? null : Number(reconciled ?? 0);

  // A non-zero count is not a routine repair — it means an event's enqueue trigger
  // threw and the safety net had to rebuild the alert. Left as a silent number in a
  // JSON body that a cron throws away, nobody would ever see it, so it goes out at
  // error level (docker logs / any log shipper) and as an explicit alert field.
  if (reconciledCount !== null && reconciledCount > 0) {
    console.error(
      `[push] reconciler backfilled ${reconciledCount} event(s) from the last 15 minutes — the enqueue trigger failed`,
    );
  }

  const drained = await drainPushOutbox();

  const { data: purged } = await admin.rpc("purge_push_outbox");

  return NextResponse.json({
    ok: true,
    reconciled: reconciledCount,
    alert:
      reconciledCount !== null && reconciledCount > 0 ? "reconciler_backfilled" : null,
    reconcile_error: reconcileError?.message ?? null,
    ...drained,
    purged: purged ?? 0,
  });
}

export async function POST(request: Request) {
  const secret = process.env.AUTOMATION_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return tick();
}

// Some schedulers only do GET; keep both so a curl in a runbook works.
export async function GET(request: Request) {
  return POST(request);
}
