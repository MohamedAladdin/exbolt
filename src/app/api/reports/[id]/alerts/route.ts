// ============================================================
// /api/reports/[id]/alerts — the alert rules of one saved report.
//
//   GET     every rule on this report
//   PUT     create or replace the rule for one metric
//   DELETE  ?metric=<key> removes that rule (all of them when omitted)
//
// Alerts are a Growth+ capability (they hang off a saved report, and saving is
// the customization line). The metric must be one the report actually
// produces — an alert on a metric that is not in the config would read `—`
// forever and never fire.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireFeature } from '@/lib/plans/guard';
import { ReportPlanError, assertCustomize, reportAccess } from '@/lib/reports/access';
import { AlertError, normalizeAlert } from '@/lib/reports/alerts';
import type { ReportConfig } from '@/lib/reports/catalog';

const SELECT =
  'id, saved_report_id, metric, comparator, threshold, cooldown_hours, is_active, last_fired_at, last_checked_at, last_value';

function refusal(err: unknown) {
  if (err instanceof AlertError) {
    return NextResponse.json({ error: err.code, detail: err.message }, { status: 400 });
  }
  if (err instanceof ReportPlanError) {
    return NextResponse.json(
      { error: err.code, detail: err.message, limit: err.limit },
      { status: err.status },
    );
  }
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireFeature('reports');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('report_alerts')
      .select(SELECT)
      .eq('saved_report_id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[reports/alerts] read failed:', error.message);
      return NextResponse.json({ error: 'read_failed' }, { status: 500 });
    }
    return NextResponse.json({ alerts: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireFeature('reports');
    try {
      assertCustomize(reportAccess(ctx.entitlements));
    } catch (err) {
      const refused = refusal(err);
      if (refused) return refused;
      throw err;
    }

    const { id } = await params;
    const body = await request.json().catch(() => null);

    const { data: report } = await ctx.supabase
      .from('saved_reports')
      .select('id, config')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!report) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const config = report.config as ReportConfig;
    let rule;
    try {
      rule = normalizeAlert(body, config.metrics ?? []);
    } catch (err) {
      const refused = refusal(err);
      if (refused) return refused;
      throw err;
    }

    const { data, error } = await ctx.supabase
      .from('report_alerts')
      .upsert(
        {
          account_id: ctx.accountId,
          saved_report_id: id,
          metric: rule.metric,
          comparator: rule.comparator,
          threshold: rule.threshold,
          cooldown_hours: rule.cooldownHours,
          is_active: rule.isActive,
          created_by: ctx.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'saved_report_id,metric' },
      )
      .select(SELECT)
      .single();

    if (error) {
      console.error('[reports/alerts] write failed:', error.message);
      return NextResponse.json({ error: 'write_failed' }, { status: 500 });
    }
    return NextResponse.json({ alert: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireFeature('reports');
    const { id } = await params;
    const metric = new URL(request.url).searchParams.get('metric');

    let query = ctx.supabase
      .from('report_alerts')
      .delete()
      .eq('saved_report_id', id)
      .eq('account_id', ctx.accountId);
    if (metric) query = query.eq('metric', metric);

    const { data, error } = await query.select('id');
    if (error) {
      console.error('[reports/alerts] delete failed:', error.message);
      return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, removed: data?.length ?? 0 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
