// ============================================================
// /api/reports — the saved-report list and creation.
//
//   GET  — every report this account can see (shared + the caller's own),
//          newest edit first. RLS does the visibility split; we never ask
//          "is it shared" in application code.
//   POST — save a validated config under a name.
//
// Plan gate: `reports` (all plans ship it). Advanced metrics require
// `reports_advanced` and are refused here with a typed 400 — the builder
// hides them, but hiding a checkbox is not a control.
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

const SELECT =
  'id, name, description, dataset, config, created_by, is_shared, created_at, updated_at';

function badRequest(err: unknown) {
  if (err instanceof ReportConfigError) {
    return NextResponse.json({ error: err.code, detail: err.message }, { status: 400 });
  }
  throw err;
}

export async function GET() {
  try {
    const ctx = await requireFeature('reports');
    const { data, error } = await ctx.supabase
      .from('saved_reports')
      .select(SELECT)
      .eq('account_id', ctx.accountId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[reports] list failed:', error.message);
      return NextResponse.json({ error: 'read_failed' }, { status: 500 });
    }
    return NextResponse.json({ reports: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireFeature('reports');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const name = String((body as { name?: unknown }).name ?? '').trim();
    if (name.length === 0 || name.length > 80) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
    }

    const descriptionRaw = (body as { description?: unknown }).description;
    const description =
      typeof descriptionRaw === 'string' ? descriptionRaw.trim().slice(0, 280) || null : null;

    const allowAdvanced = ctx.entitlements.features.reports_advanced !== false;
    let config;
    try {
      config = normalizeReportConfig((body as { config?: unknown }).config, {
        today: todayIn(browserTimeZone()),
        timeZone: browserTimeZone(),
        allowAdvanced,
      });
    } catch (err) {
      return badRequest(err);
    }

    const { data, error } = await ctx.supabase
      .from('saved_reports')
      .insert({
        account_id: ctx.accountId,
        name,
        description,
        dataset: config.dataset,
        config,
        created_by: ctx.userId,
      })
      .select(SELECT)
      .single();

    if (error) {
      console.error('[reports] save failed:', error.message);
      return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    }
    return NextResponse.json({ report: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
