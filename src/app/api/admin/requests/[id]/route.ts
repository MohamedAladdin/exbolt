/**
 * PATCH /api/admin/requests/[id] — triage a tenant renewal/plan-change request.
 * Platform-admin only; writes through the service role and records an audit row.
 */

import { NextResponse } from 'next/server';

import { requirePlatformAdmin, adminErrorResponse } from '@/lib/admin/auth';
import { logAdminAction } from '@/lib/admin/audit';
import { adminDb } from '@/lib/admin/db';

const STATUSES = ['new', 'in_review', 'done', 'declined'] as const;
type Status = (typeof STATUSES)[number];

function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new Error('invalid_body');

    const status = body.status;
    if (status !== undefined && !isStatus(status)) {
      return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
    }

    const notes =
      typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : undefined;

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status !== undefined) patch.status = status;
    if (notes !== undefined) patch.admin_notes = notes || null;

    const { data, error } = await adminDb()
      .from('account_requests')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      console.error('account_request_update_failed', error.message);
      return NextResponse.json({ error: 'update_failed' }, { status: 500 });
    }

    await logAdminAction({
      actor,
      action: 'request.update',
      targetType: 'request',
      targetId: id,
      details: { status: status ?? data.status },
    });

    return NextResponse.json({ ok: true, request: data });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
