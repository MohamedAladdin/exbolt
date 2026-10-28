/**
 * Tenant plan requests — renew the current plan or ask to change it.
 *
 * GET  /api/account/requests  — the account's recent requests (RLS-scoped)
 * POST /api/account/requests  — create one request (admin/owner only)
 *
 * A request is NOT an entitlement change. The platform team reviews it in
 * /admin/requests and applies the plan from the super-admin panel.
 */

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getAccountEntitlements } from '@/lib/plans/entitlements';

const KINDS = ['renewal', 'change_plan'] as const;
const INTERVALS = ['monthly', 'annual'] as const;

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { data, error } = await supabase
      .from('account_requests')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[account/requests] read failed:', error.message);
      return NextResponse.json({ error: 'requests_unavailable' }, { status: 500 });
    }
    return NextResponse.json({ requests: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

    const kind = String(body.kind ?? '');
    if (!(KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });
    }

    const interval = String(body.billingInterval ?? 'monthly');
    if (!(INTERVALS as readonly string[]).includes(interval)) {
      return NextResponse.json({ error: 'invalid_interval' }, { status: 400 });
    }

    const entitlements = await getAccountEntitlements(ctx.supabase, ctx.accountId);
    const currentCode = entitlements.plan.code;
    let requestedCode = currentCode;

    if (kind === 'change_plan') {
      requestedCode = String(body.requestedPlanCode ?? '').trim();
      if (!requestedCode) {
        return NextResponse.json({ error: 'plan_required' }, { status: 400 });
      }
      if (requestedCode === currentCode) {
        return NextResponse.json({ error: 'same_plan' }, { status: 400 });
      }
      const { data: plan, error: planError } = await ctx.supabase
        .from('plans')
        .select('code')
        .eq('code', requestedCode)
        .eq('is_active', true)
        .maybeSingle();
      if (planError || !plan) {
        return NextResponse.json({ error: 'plan_not_found' }, { status: 400 });
      }
    }

    // One open request per account is enough; the admin resolves it before a
    // second one is needed. Avoids duplicate rows from double-clicks.
    const { data: pending } = await ctx.supabase
      .from('account_requests')
      .select('id, status')
      .eq('account_id', ctx.accountId)
      .in('status', ['new', 'in_review'])
      .limit(1)
      .maybeSingle();
    if (pending) {
      return NextResponse.json({ error: 'request_pending' }, { status: 409 });
    }

    const message =
      typeof body.message === 'string' ? body.message.trim().slice(0, 1500) : null;

    const { data, error } = await ctx.supabase
      .from('account_requests')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        kind,
        current_plan_code: currentCode,
        requested_plan_code: requestedCode,
        billing_interval: interval,
        message: message || null,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[account/requests] insert failed:', error.message);
      return NextResponse.json({ error: 'request_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, request: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
