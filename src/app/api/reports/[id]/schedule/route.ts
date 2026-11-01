// ============================================================
// /api/reports/[id]/schedule — the delivery schedule of one saved report.
//
//   GET     the current schedule (or null)
//   PUT     create/update it (one per report — the table has a unique key)
//   DELETE  stop mailing it
//
// Scheduling is a Growth+ capability: it is only useful on a *saved* report,
// and saving is already the customization line.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireFeature } from '@/lib/plans/guard';
import { ReportPlanError, assertCustomize, reportAccess } from '@/lib/reports/access';
import { browserTimeZone } from '@/lib/reports/catalog';
import { ScheduleError, normalizeSchedule } from '@/lib/reports/schedule';

const SELECT =
  'id, saved_report_id, cadence, weekday, day_of_month, hour, time_zone, recipients, format, is_active, last_sent_at, last_error';

function failure(err: unknown) {
  if (err instanceof ScheduleError) {
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
      .from('report_schedules')
      .select(SELECT)
      .eq('saved_report_id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[reports/schedule] read failed:', error.message);
      return NextResponse.json({ error: 'read_failed' }, { status: 500 });
    }
    return NextResponse.json({ schedule: data ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireFeature('reports');
    const access = reportAccess(ctx.entitlements);
    try {
      assertCustomize(access);
    } catch (err) {
      const refusal = failure(err);
      if (refusal) return refusal;
      throw err;
    }

    const { id } = await params;
    const body = await request.json().catch(() => null);

    let schedule;
    try {
      schedule = normalizeSchedule(body, browserTimeZone());
    } catch (err) {
      const refusal = failure(err);
      if (refusal) return refusal;
      throw err;
    }

    // The report must belong to this account before it can be scheduled; RLS
    // would answer 0 rows, but then the INSERT would fail on a foreign key.
    const { data: report } = await ctx.supabase
      .from('saved_reports')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!report) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const { data, error } = await ctx.supabase
      .from('report_schedules')
      .upsert(
        {
          account_id: ctx.accountId,
          saved_report_id: id,
          cadence: schedule.cadence,
          weekday: schedule.weekday,
          day_of_month: schedule.dayOfMonth,
          hour: schedule.hour,
          time_zone: schedule.timeZone,
          recipients: schedule.recipients,
          format: schedule.format,
          is_active: schedule.isActive,
          created_by: ctx.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'saved_report_id' },
      )
      .select(SELECT)
      .single();

    if (error) {
      console.error('[reports/schedule] write failed:', error.message);
      return NextResponse.json({ error: 'write_failed' }, { status: 500 });
    }
    return NextResponse.json({ schedule: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireFeature('reports');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('report_schedules')
      .delete()
      .eq('saved_report_id', id)
      .eq('account_id', ctx.accountId)
      .select('id');

    if (error) {
      console.error('[reports/schedule] delete failed:', error.message);
      return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, removed: data?.length ?? 0 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
