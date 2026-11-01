// ============================================================
// Reports — the scheduled email.
//
// One HTML mail with the table inline, not an attachment: a CSV the manager has
// to download and open is a step nobody takes at 8am, and Arabic CSV in a mail
// client is a coin flip on encoding. The screen version is still one click away
// (the mail links to /reports).
//
// Same SMTP contract as the admin panel (nodemailer; SES SMTP on the box). With
// no SMTP_HOST it reports `dry_run` instead of pretending — the cron writes that
// into `report_schedules.last_error` so the operator sees it.
// ============================================================

import nodemailer from 'nodemailer';

import { escapeHtml } from '@/lib/billing/invoice-document';
import type { PreparedTable } from './render';

export interface ReportEmailInput {
  title: string;
  brandName: string;
  logoUrl?: string | null;
  vendorName: string;
  locale: string;
  periodLabel: string;
  generatedLabel: string;
  footerNote: string;
  truncatedNote?: string | null;
  table: PreparedTable;
  linkUrl: string;
  linkLabel: string;
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function renderReportEmail(input: ReportEmailInput): { subject: string; html: string; text: string } {
  const rtl = input.locale.startsWith('ar');
  const dir = rtl ? 'rtl' : 'ltr';

  const header = input.table.columns
    .map((column) => `<th style="padding:8px 10px;border-bottom:2px solid #d1d5db;background:#f3f4f6;text-align:${column.align === 'end' ? (rtl ? 'left' : 'right') : rtl ? 'right' : 'left'};font:600 12px/1.4 'Segoe UI',Tahoma,Arial,sans-serif;color:#111827">${escapeHtml(column.label)}</th>`)
    .join('');

  const body = input.table.rows
    .map(
      (cells, rowIndex) =>
        `<tr style="background:${rowIndex % 2 ? '#fafbfc' : '#ffffff'}">${cells
          .map((cell, index) => {
            const align = input.table.columns[index]?.align ?? 'start';
            return `<td style="padding:7px 10px;border-bottom:1px solid #eef0f3;text-align:${align === 'end' ? (rtl ? 'left' : 'right') : rtl ? 'right' : 'left'};font:400 12px/1.5 'Segoe UI',Tahoma,Arial,sans-serif;color:#111827;${align === 'end' ? 'font-variant-numeric:tabular-nums;white-space:nowrap' : ''}">${escapeHtml(cell)}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');

  const totals = input.table.totals
    ? `<tr>${input.table.totals
        .map(
          (cell, index) =>
            `<td style="padding:8px 10px;border-top:2px solid #d1d5db;background:#f3f4f6;font:700 12px/1.4 'Segoe UI',Tahoma,Arial,sans-serif;color:#111827;text-align:${input.table.columns[index]?.align === 'end' ? (rtl ? 'left' : 'right') : rtl ? 'right' : 'left'}">${escapeHtml(cell)}</td>`,
        )
        .join('')}</tr>`
    : '';

  const logo = input.logoUrl && /^https?:\/\//i.test(input.logoUrl) ? input.logoUrl : null;

  const html = `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${dir}">
<body style="margin:0;padding:24px;background:#eef1f5;">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;direction:${dir};">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:4px;">
      <div style="font:700 15px/1.4 'Segoe UI',Tahoma,Arial,sans-serif;color:#111827;">
        ${logo ? `<img src="${escapeHtml(logo)}" alt="" style="display:block;max-height:48px;max-width:180px;object-fit:contain;margin-bottom:6px">` : ''}
        ${escapeHtml(input.brandName)}
      </div>
      <div style="font:400 11px/1.6 'Segoe UI',Tahoma,Arial,sans-serif;color:#6b7280;">${escapeHtml(input.periodLabel)}</div>
    </div>
    <h1 style="margin:12px 0 4px;font:700 18px/1.3 'Segoe UI',Tahoma,Arial,sans-serif;color:#111827;">${escapeHtml(input.title)}</h1>
    <div style="font:400 11px/1.6 'Segoe UI',Tahoma,Arial,sans-serif;color:#6b7280;margin-bottom:14px;">${escapeHtml(input.generatedLabel)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
      ${totals ? `<tfoot>${totals}</tfoot>` : ''}
    </table>
    ${input.truncatedNote ? `<p style="margin:12px 0 0;font:600 11px/1.6 'Segoe UI',Tahoma,Arial,sans-serif;color:#b45309;">${escapeHtml(input.truncatedNote)}</p>` : ''}
    <p style="margin:16px 0 0;">
      <a href="${escapeHtml(input.linkUrl)}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#111827;color:#ffffff;font:600 12px/1 'Segoe UI',Tahoma,Arial,sans-serif;text-decoration:none;">${escapeHtml(input.linkLabel)}</a>
    </p>
    <p style="margin:18px 0 0;padding-top:12px;border-top:1px solid #e5e7eb;font:400 10px/1.6 'Segoe UI',Tahoma,Arial,sans-serif;color:#9ca3af;">${escapeHtml(input.footerNote)} · ${escapeHtml(input.vendorName)}</p>
  </div>
</body>
</html>`;

  const text = [
    input.title,
    input.periodLabel,
    '',
    input.table.columns.map((column) => column.label).join('\t'),
    ...input.table.rows.map((cells) => cells.join('\t')),
    input.table.totals ? input.table.totals.join('\t') : '',
    '',
    input.generatedLabel,
    input.linkUrl,
  ]
    .filter((line) => line !== null)
    .join('\n');

  return { subject: `${input.title} · ${input.periodLabel}`, html, text };
}

export type MailResult = 'sent' | 'dry_run' | 'failed';

export async function sendReportEmail(params: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  from?: string;
}): Promise<{ status: MailResult; error?: string }> {
  if (!isMailConfigured()) return { status: 'dry_run', error: 'smtp_not_configured' };

  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    });
    await transport.sendMail({
      from: params.from ?? process.env.MAIL_FROM ?? process.env.SMTP_USER,
      to: params.to.join(', '),
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    return { status: 'sent' };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : 'send_failed' };
  }
}
