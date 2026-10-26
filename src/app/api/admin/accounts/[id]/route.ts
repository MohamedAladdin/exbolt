/**
 * /api/admin/accounts/[id] — one mutation endpoint for a tenant.
 *
 * Action-dispatched rather than one REST route per verb: the panel is a
 * command surface (suspend / change plan / grant / block a member / email
 * a customer) and every command shares the same gate, audit and error
 * handling. The body carries `action`, so an unknown action fails loudly.
 *
 *   PATCH { action: "status", status, reason }
 *   PATCH { action: "plan", planCode, status?, billingInterval?, ... }
 *   PATCH { action: "notes", notes }
 *   PATCH { action: "grant", kind, key?, value?, reason?, expiresAt? }
 *   PATCH { action: "revoke_grant", grantId }
 *   PATCH { action: "member_block", userId, blocked, reason? }
 *   PATCH { action: "email", to, subject, body, toName? }
 */

import { NextResponse } from 'next/server';

import { requirePlatformAdmin, adminErrorResponse } from '@/lib/admin/auth';
import {
  createGrant,
  isAccountStatus,
  revokeGrant,
  sendCustomEmailToAccount,
  setAccountStatus,
  setDocumentNotes,
  setMemberBlock,
  setSubscription,
} from '@/lib/admin/mutations';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new Error('invalid_body');

    switch (body.action) {
      case 'status': {
        if (!isAccountStatus(body.status)) throw new Error('invalid_status');
        const result = await setAccountStatus({
          actor,
          accountId: id,
          status: body.status,
          reason: typeof body.reason === 'string' ? body.reason : null,
        });
        return NextResponse.json(result);
      }

      case 'plan': {
        const planCode =
          body.planCode === null ? null : String(body.planCode ?? '');
        if (planCode !== null && !planCode)
          throw new Error('invalid_plan_code');
        const result = await setSubscription({
          actor,
          accountId: id,
          planCode,
          status:
            typeof body.status === 'string'
              ? (body.status as never)
              : undefined,
          billingInterval:
            body.billingInterval === 'annual'
              ? 'annual'
              : body.billingInterval === 'monthly'
                ? 'monthly'
                : undefined,
          currentPeriodEnd: (body.currentPeriodEnd as string | null) ?? null,
          trialEndsAt: (body.trialEndsAt as string | null) ?? null,
          featureOverrides:
            (body.featureOverrides as Record<string, boolean>) ?? undefined,
          limitOverrides:
            (body.limitOverrides as Record<string, number | null>) ?? undefined,
        });
        return NextResponse.json(result);
      }

      case 'notes': {
        const result = await setDocumentNotes({
          actor,
          accountId: id,
          notes: typeof body.notes === 'string' ? body.notes : null,
        });
        return NextResponse.json(result);
      }

      case 'grant': {
        const result = await createGrant({
          actor,
          accountId: id,
          kind: String(body.kind ?? '') as never,
          key: typeof body.key === 'string' ? body.key : null,
          value: body.value,
          reason: typeof body.reason === 'string' ? body.reason : null,
          expiresAt:
            typeof body.expiresAt === 'string' && body.expiresAt
              ? body.expiresAt
              : null,
        });
        return NextResponse.json(result);
      }

      case 'revoke_grant': {
        if (typeof body.grantId !== 'string')
          throw new Error('invalid_grant_id');
        const result = await revokeGrant({
          actor,
          accountId: id,
          grantId: body.grantId,
        });
        return NextResponse.json(result);
      }

      case 'member_block': {
        if (typeof body.userId !== 'string') throw new Error('invalid_user_id');
        const result = await setMemberBlock({
          actor,
          accountId: id,
          userId: body.userId,
          blocked: body.blocked === true,
          reason: typeof body.reason === 'string' ? body.reason : null,
        });
        return NextResponse.json(result);
      }

      case 'email': {
        const to = String(body.to ?? '').trim();
        const subject = String(body.subject ?? '').trim();
        const text = String(body.body ?? '');
        if (!to.includes('@')) throw new Error('invalid_email');
        if (!subject) throw new Error('invalid_subject');
        if (!text.trim()) throw new Error('invalid_body');
        const result = await sendCustomEmailToAccount({
          actor,
          accountId: id,
          to,
          subject,
          body: text,
          toName: typeof body.toName === 'string' ? body.toName : undefined,
        });
        return NextResponse.json(result);
      }

      default:
        throw new Error('invalid_action');
    }
  } catch (err) {
    return adminErrorResponse(err);
  }
}
