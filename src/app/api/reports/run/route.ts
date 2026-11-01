// ============================================================
// /api/reports/run — execute a config.
//
// A POST, not a GET with a query string: the config carries arrays of
// filters, and a report URL that can be bookmarked is exactly what
// `saved_reports` is for. This endpoint is the only path that reaches
// `run_report`, so the plan gate and the validation cannot be bypassed by
// calling the RPC from the browser (the RPC itself is revoked from anon).
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireFeature } from '@/lib/plans/guard';
import {
  ReportConfigError,
  browserTimeZone,
  normalizeReportConfig,
  todayIn,
} from '@/lib/reports/catalog';
import { ReportRunError, runReport } from '@/lib/reports/run';

export async function POST(request: Request) {
  try {
    const ctx = await requireFeature('reports');
    const body = await request.json().catch(() => null);

    const allowAdvanced = ctx.entitlements.features.reports_advanced !== false;
    let config;
    try {
      config = normalizeReportConfig((body as { config?: unknown } | null)?.config, {
        today: todayIn(browserTimeZone()),
        timeZone: browserTimeZone(),
        allowAdvanced,
      });
    } catch (err) {
      if (err instanceof ReportConfigError) {
        return NextResponse.json({ error: err.code, detail: err.message }, { status: 400 });
      }
      throw err;
    }

    try {
      const result = await runReport(ctx.supabase, config);
      // The normalised config goes back with the answer: the UI shows the
      // period it actually ran over, which is not always what was typed
      // (an empty date field becomes "last 30 days").
      return NextResponse.json({ config, result });
    } catch (err) {
      if (err instanceof ReportRunError) {
        return NextResponse.json({ error: 'invalid_report', detail: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
