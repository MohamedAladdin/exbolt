// ============================================================
// /api/reports/[id] — rename, edit the definition, share/unshare, delete.
//
// Authorisation lives in two places on purpose:
//   * RLS (`saved_reports_update` / `_delete`): the caller must be an agent
//     in the account AND (own the row OR be admin+). That is the real gate.
//   * This handler: rejecting a request that matched zero rows with a 404, so
//     "someone else's report" and "deleted a minute ago" look the same from
//     outside instead of leaking which ids exist.
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireFeature('reports');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const raw = body as Record<string, unknown>;

    if (raw.name !== undefined) {
      const name = String(raw.name ?? '').trim();
      if (name.length === 0 || name.length > 80) {
        return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
      }
      patch.name = name;
    }

    if (raw.description !== undefined) {
      patch.description =
        typeof raw.description === 'string' ? raw.description.trim().slice(0, 280) || null : null;
    }

    if (raw.is_shared !== undefined) {
      patch.is_shared = raw.is_shared === true;
    }

    if (raw.config !== undefined) {
      const allowAdvanced = ctx.entitlements.features.reports_advanced !== false;
      try {
        const config = normalizeReportConfig(raw.config, {
          today: todayIn(browserTimeZone()),
          timeZone: browserTimeZone(),
          allowAdvanced,
        });
        patch.config = config;
        patch.dataset = config.dataset;
      } catch (err) {
        if (err instanceof ReportConfigError) {
          return NextResponse.json({ error: err.code, detail: err.message }, { status: 400 });
        }
        throw err;
      }
    }

    const { data, error } = await ctx.supabase
      .from('saved_reports')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(SELECT)
      .maybeSingle();

    if (error) {
      console.error('[reports] update failed:', error.message);
      return NextResponse.json({ error: 'update_failed' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({ report: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireFeature('reports');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('saved_reports')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id');

    if (error) {
      console.error('[reports] delete failed:', error.message);
      return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
