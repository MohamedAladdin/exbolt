/**
 * Outbound email for the admin panel: invoices, payment reminders, and
 * one-off messages to a customer.
 *
 * Transport: SMTP via nodemailer. That covers SES SMTP credentials (what
 * the production box uses), a Gmail app password, Mailgun, or a local
 * mailhog — one env contract, no provider SDK.
 *
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (false), SMTP_USER, SMTP_PASS
 *   MAIL_FROM            optional envelope sender override
 *
 * With no SMTP_HOST the panel does NOT pretend to send: the message is
 * rendered, stored in `outbound_emails` with status `dry_run`, and the
 * operator is told plainly. That is the state a fresh install starts in.
 */

import nodemailer from 'nodemailer';

import { adminDb } from './db';
import { formatMoney } from './format';
import type { InvoiceRow, SettingsRow } from './queries';
import type { PlatformAdmin } from './auth';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  status: 'sent' | 'dry_run' | 'failed';
  id: string | null;
  error?: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
}

function fromAddress(settings: SettingsRow): string {
  return (
    process.env.MAIL_FROM ||
    (settings.billingFromEmail
      ? `${settings.billingFromName} <${settings.billingFromEmail}>`
      : process.env.SMTP_USER || 'noreply@localhost')
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Shared shell: RTL-first, inline styles, no external assets. */
function wrap(bodyHtml: string, settings: SettingsRow): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#18181b">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
    <div style="padding:20px 24px;border-bottom:1px solid #e4e4e7">
      <div style="font-size:16px;font-weight:700">${escapeHtml(settings.billingFromName)}</div>
      <div style="font-size:12px;color:#71717a">${escapeHtml(settings.supportEmail ?? settings.billingReplyTo ?? '')}</div>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.8">${bodyHtml}</div>
    <div style="padding:16px 24px;border-top:1px solid #e4e4e7;font-size:11px;color:#71717a">
      ${escapeHtml(settings.billingFromName)} · ${escapeHtml(settings.supportEmail ?? '')}
    </div>
  </div>
</body>
</html>`;
}

function invoiceTable(invoice: InvoiceRow): string {
  const rows = invoice.lineItems
    .map(
      (item) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5">${escapeHtml(item.description)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;text-align:center">${item.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;text-align:left;direction:ltr">${formatMoney(item.unit_price, invoice.currency)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;text-align:left;direction:ltr">${formatMoney(item.quantity * item.unit_price, invoice.currency)}</td>
      </tr>`
    )
    .join('');

  return `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0">
    <thead>
      <tr style="color:#71717a;font-size:11px">
        <th style="text-align:right;padding-bottom:8px">البند</th>
        <th style="text-align:center;padding-bottom:8px">الكمية</th>
        <th style="text-align:left;padding-bottom:8px">السعر</th>
        <th style="text-align:left;padding-bottom:8px">الإجمالي</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <table style="width:100%;font-size:14px;margin-top:8px">
    <tr><td style="color:#71717a">الإجمالي قبل الضريبة</td><td style="text-align:left;direction:ltr">${formatMoney(invoice.amount - invoice.tax, invoice.currency)}</td></tr>
    ${invoice.tax > 0 ? `<tr><td style="color:#71717a">الضريبة</td><td style="text-align:left;direction:ltr">${formatMoney(invoice.tax, invoice.currency)}</td></tr>` : ''}
    <tr><td style="font-weight:700;padding-top:8px">المطلوب سداده</td><td style="font-weight:700;text-align:left;padding-top:8px;direction:ltr">${formatMoney(invoice.amount, invoice.currency)}</td></tr>
  </table>`;
}

export function renderInvoiceEmail(
  invoice: InvoiceRow,
  settings: SettingsRow,
  kind: 'invoice' | 'receipt' = 'invoice'
): RenderedEmail {
  const isReceipt = kind === 'receipt';
  const subject = isReceipt
    ? `إيصال سداد — فاتورة ${invoice.number}`
    : `فاتورة ${invoice.number} — ${settings.billingFromName}`;

  const intro = isReceipt
    ? `<p>تم استلام مبلغ <strong>${formatMoney(invoice.amount, invoice.currency)}</strong> بالكامل. شكرًا لالتزامكم.</p>`
    : `<p>مرفق تفاصيل فاتورة <strong>${invoice.number}</strong> بمبلغ <strong>${formatMoney(
        invoice.amount,
        invoice.currency
      )}</strong>، وميعاد السداد <strong>${invoice.dueDate}</strong>.</p>`;

  const body = `
    <p style="margin:0 0 12px">أهلاً ${escapeHtml(invoice.toName ?? '')}،</p>
    ${intro}
    <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;padding:12px;font-size:12px;margin:16px 0">
      <div>رقم الفاتورة: <strong style="direction:ltr;display:inline-block">${escapeHtml(invoice.number)}</strong></div>
      <div>تاريخ الإصدار: ${escapeHtml(invoice.issueDate)}</div>
      <div>ميعاد السداد: ${escapeHtml(invoice.dueDate)}</div>
      ${invoice.periodStart && invoice.periodEnd ? `<div>فترة الخدمة: ${escapeHtml(invoice.periodStart)} → ${escapeHtml(invoice.periodEnd)}</div>` : ''}
    </div>
    ${invoiceTable(invoice)}
    ${invoice.notes ? `<p style="font-size:12px;color:#71717a;margin-top:16px">${escapeHtml(invoice.notes)}</p>` : ''}
    <p style="font-size:12px;color:#71717a;margin-top:20px">لو في أي استفسار، رد على الإيميل ده أو تواصل معنا على ${escapeHtml(
      settings.supportEmail ?? ''
    )}.</p>`;

  const text = [
    `فاتورة ${invoice.number}`,
    `المبلغ: ${formatMoney(invoice.amount, invoice.currency)}`,
    `ميعاد السداد: ${invoice.dueDate}`,
    ...invoice.lineItems.map(
      (item) =>
        `- ${item.description} ×${item.quantity} = ${formatMoney(item.quantity * item.unit_price, invoice.currency)}`
    ),
  ].join('\n');

  return { subject, text, html: wrap(body, settings) };
}

export function renderReminderEmail(
  invoice: InvoiceRow,
  settings: SettingsRow,
  stage: 'upcoming' | 'overdue' | 'final'
): RenderedEmail {
  const subject =
    stage === 'upcoming'
      ? `تذكير: فاتورة ${invoice.number} مستحقة ${invoice.dueDate}`
      : stage === 'overdue'
        ? `فاتورة ${invoice.number} متأخرة عن ميعاد السداد`
        : `تنبيه أخير: فاتورة ${invoice.number} متأخرة`;

  const message =
    stage === 'upcoming'
      ? `دي مجرد تذكير إن فاتورة <strong>${escapeHtml(invoice.number)}</strong> بمبلغ <strong>${formatMoney(
          invoice.amount,
          invoice.currency
        )}</strong> مستحقة السداد يوم <strong>${escapeHtml(invoice.dueDate)}</strong>.`
      : stage === 'overdue'
        ? `فاتورة <strong>${escapeHtml(invoice.number)}</strong> بمبلغ <strong>${formatMoney(
            invoice.amount,
            invoice.currency
          )}</strong> فات ميعاد سدادها (${escapeHtml(invoice.dueDate)}).`
        : `فاتورة <strong>${escapeHtml(invoice.number)}</strong> بمبلغ <strong>${formatMoney(
            invoice.amount,
            invoice.currency
          )}</strong> لسه غير مسددة بعد ميعاد السداد بفترة. من فضلك راجعها، ولو فيه أي مشكلة كلمنا.`;

  const body = `
    <p style="margin:0 0 12px">أهلاً ${escapeHtml(invoice.toName ?? '')}،</p>
    <p>${message}</p>
    ${invoiceTable(invoice)}
    <p style="font-size:12px;color:#71717a;margin-top:20px">للتواصل: ${escapeHtml(settings.supportEmail ?? '')}</p>`;

  return {
    subject,
    text: `${subject}\n${formatMoney(invoice.amount, invoice.currency)} — ${invoice.dueDate}`,
    html: wrap(body, settings),
  };
}

export function renderCustomEmail(
  settings: SettingsRow,
  params: { toName: string; body: string; subject: string }
): RenderedEmail {
  const body = `<p style="margin:0 0 12px">أهلاً ${escapeHtml(params.toName)}،</p>
    <div style="white-space:pre-wrap">${escapeHtml(params.body)}</div>`;
  return {
    subject: params.subject,
    text: params.body,
    html: wrap(body, settings),
  };
}

/**
 * Deliver one message and record it. Never throws: a mail failure is a
 * row with status `failed`, which is what the operator needs to see.
 */
export async function sendEmail(params: {
  to: string;
  rendered: RenderedEmail;
  kind: 'invoice' | 'reminder' | 'receipt' | 'welcome' | 'custom' | 'test';
  settings: SettingsRow;
  accountId?: string | null;
  invoiceId?: string | null;
  actor?: PlatformAdmin | null;
}): Promise<SendResult> {
  const { to, rendered, kind, settings } = params;
  const db = adminDb();

  const baseRow = {
    account_id: params.accountId ?? null,
    invoice_id: params.invoiceId ?? null,
    kind,
    to_email: to,
    subject: rendered.subject,
    body_text: rendered.text,
    body_html: rendered.html,
    created_by: params.actor?.userId ?? null,
  };

  if (!isEmailConfigured()) {
    const { data } = await db
      .from('outbound_emails')
      .insert({ ...baseRow, status: 'dry_run' })
      .select('id')
      .maybeSingle();
    return {
      status: 'dry_run',
      id: (data?.id as string | undefined) ?? null,
      error: 'smtp_not_configured',
    };
  }

  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    });

    const info = await transport.sendMail({
      from: fromAddress(settings),
      to,
      replyTo: settings.billingReplyTo ?? settings.supportEmail ?? undefined,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });

    const { data } = await db
      .from('outbound_emails')
      .insert({
        ...baseRow,
        status: 'sent',
        provider: 'smtp',
        provider_message_id: info.messageId ?? null,
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();

    return { status: 'sent', id: (data?.id as string | undefined) ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'send_failed';
    const { data } = await db
      .from('outbound_emails')
      .insert({
        ...baseRow,
        status: 'failed',
        provider: 'smtp',
        error: message,
      })
      .select('id')
      .maybeSingle();
    return {
      status: 'failed',
      id: (data?.id as string | undefined) ?? null,
      error: message,
    };
  }
}
