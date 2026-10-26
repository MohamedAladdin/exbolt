/**
 * /api/admin/invoices — create, send, update, run reminders.
 *
 *   POST { action: "create", accountId, lineItems[], tax?, currency?,
 *          issueDate?, dueDate?, periodStart?, periodEnd?, planCode?,
 *          notes?, toEmail?, toName? }
 *   POST { action: "send", invoiceId, to? }
 *   POST { action: "update", invoiceId, status?, dueDate?, notes?, toEmail? }
 *   POST { action: "remind" }                     → run the reminder policy now
 */

import { NextResponse } from 'next/server';

import { requirePlatformAdmin, adminErrorResponse } from '@/lib/admin/auth';
import {
  createInvoice,
  runReminders,
  sendInvoice,
  updateInvoice,
} from '@/lib/admin/mutations';

export async function POST(request: Request) {
  try {
    const actor = await requirePlatformAdmin();
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new Error('invalid_body');

    switch (body.action) {
      case 'create': {
        const accountId = String(body.accountId ?? '');
        if (!accountId) throw new Error('invalid_account_id');
        const invoice = await createInvoice({
          actor,
          accountId,
          lineItems: (body.lineItems ?? []) as never,
          tax: Number(body.tax ?? 0),
          currency:
            typeof body.currency === 'string' ? body.currency : undefined,
          issueDate:
            typeof body.issueDate === 'string' ? body.issueDate : undefined,
          dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
          periodStart: (body.periodStart as string | null) ?? null,
          periodEnd: (body.periodEnd as string | null) ?? null,
          planCode: (body.planCode as string | null) ?? null,
          notes: (body.notes as string | null) ?? null,
          toEmail: (body.toEmail as string | null) ?? null,
          toName: (body.toName as string | null) ?? null,
        });
        return NextResponse.json({ invoice });
      }

      case 'send': {
        const invoiceId = String(body.invoiceId ?? '');
        if (!invoiceId) throw new Error('invalid_invoice_id');
        const result = await sendInvoice({
          actor,
          invoiceId,
          to: typeof body.to === 'string' ? body.to : undefined,
        });
        return NextResponse.json(result);
      }

      case 'update': {
        const invoiceId = String(body.invoiceId ?? '');
        if (!invoiceId) throw new Error('invalid_invoice_id');
        const result = await updateInvoice({
          actor,
          invoiceId,
          status:
            typeof body.status === 'string'
              ? (body.status as never)
              : undefined,
          dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
          notes: typeof body.notes === 'string' ? body.notes : undefined,
          toEmail: typeof body.toEmail === 'string' ? body.toEmail : undefined,
        });
        return NextResponse.json(result);
      }

      case 'remind': {
        const result = await runReminders(actor);
        return NextResponse.json(result);
      }

      default:
        throw new Error('invalid_action');
    }
  } catch (err) {
    return adminErrorResponse(err);
  }
}
