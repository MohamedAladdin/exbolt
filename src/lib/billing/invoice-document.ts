/**
 * Printable invoice document — pure string rendering, no I/O.
 *
 * The admin panel can compose and email an invoice, but a tenant had no way
 * to see or keep its own copy. This module turns an `invoices` row plus the
 * account identity into a self-contained A4 HTML file: no external CSS, no
 * fonts to fetch, no scripts — downloaded once, it opens and prints offline.
 *
 * Everything user-controlled is HTML-escaped here (`escapeHtml`), because a
 * client name or a note can contain `<` and this document is served as
 * text/html.
 */

export interface InvoiceLineItem {
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
}

export interface InvoiceDocumentInput {
  number: string;
  status: string;
  /** ISO date (`YYYY-MM-DD`) the invoice was issued. */
  issueDate: string;
  dueDate?: string | null;
  /** ISO timestamp, UTC. */
  paidAt?: string | null;
  currency: string;
  amount: number | string;
  tax?: number | string | null;
  lineItems?: InvoiceLineItem[] | null;
  notes?: string | null;
  toName?: string | null;
  toEmail?: string | null;
  /** Tenant identity (the buyer). */
  accountName: string;
  /** Who issued it (EXCAL / ExBolt). */
  vendorName: string;
  vendorUrl?: string | null;
  /** Payment reference, e.g. a Binance order id. */
  paymentReference?: string | null;
  paymentPayer?: string | null;
  /** Timezone used for every printed date. */
  timeZone?: string;
}

const STATUS_LABEL: Record<string, string> = {
  paid: 'مدفوعة',
  sent: 'مرسلة',
  overdue: 'متأخرة',
  draft: 'مسودة',
  void: 'ملغاة',
};

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  EUR: '€',
  EGP: 'ج.م',
  SAR: 'ر.س',
  AED: 'د.إ',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMoney(value: number | string, currency: string): string {
  const amount = Number(value ?? 0);
  const safe = Number.isFinite(amount) ? amount : 0;
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  const fixed = safe.toFixed(2);
  return symbol.length === 1 ? `${symbol}${fixed}` : `${fixed} ${symbol}`;
}

/** `2026-10-24` → `24 أكتوبر 2026`, without Intl locale surprises. */
export function formatDate(
  value: string | null | undefined,
  timeZone = 'Africa/Cairo',
): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: value.length === 10 ? 'UTC' : timeZone,
  }).format(date);
}

export function formatDateTime(
  value: string | null | undefined,
  timeZone = 'Africa/Cairo',
): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

function rows(items: InvoiceLineItem[]): string {
  return items
    .map((item) => {
      const quantity = Number(item.quantity ?? 1) || 0;
      const unit = Number(item.unit_price ?? 0) || 0;
      const total = Math.round(quantity * unit * 100) / 100;
      return `<tr>
        <td class="desc">${escapeHtml(item.description ?? '')}</td>
        <td class="num">${quantity}</td>
        <td class="num">${escapeHtml(unit.toFixed(2))}</td>
        <td class="num">${escapeHtml(total.toFixed(2))}</td>
      </tr>`;
    })
    .join('');
}

export function renderInvoiceHtml(input: InvoiceDocumentInput): string {
  const timeZone = input.timeZone ?? 'Africa/Cairo';
  const items = Array.isArray(input.lineItems) ? input.lineItems : [];
  const status = STATUS_LABEL[String(input.status)] ?? String(input.status);
  const total = formatMoney(input.amount, input.currency);
  const tax = Number(input.tax ?? 0);

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>فاتورة ${escapeHtml(input.number)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px;
    font-family: "Segoe UI", Tahoma, "Noto Naskh Arabic", Arial, sans-serif;
    color: #111827; background: #f3f4f6; direction: rtl;
  }
  .sheet {
    max-width: 820px; margin: 0 auto; background: #fff; border-radius: 14px;
    padding: 40px 44px; box-shadow: 0 8px 30px rgba(15, 23, 42, .08);
  }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .vendor { font-size: 22px; font-weight: 700; letter-spacing: .5px; }
  .vendor small { display: block; font-size: 12px; font-weight: 400; color: #6b7280; margin-top: 4px; }
  .doc { text-align: left; }
  .doc h1 { margin: 0; font-size: 26px; letter-spacing: 2px; color: #0f172a; }
  .doc .number { font: 600 14px/1.6 ui-monospace, monospace; color: #374151; }
  .badge {
    display: inline-block; margin-top: 6px; padding: 3px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
  }
  .badge.unpaid { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 28px 0 8px; }
  .meta div { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
  .meta span { display: block; font-size: 11px; color: #6b7280; margin-bottom: 4px; }
  .meta b { font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-top: 22px; }
  th, td { padding: 11px 8px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right; }
  th { background: #f9fafb; font-size: 12px; color: #374151; }
  td.num, th.num { text-align: left; font-variant-numeric: tabular-nums; }
  .totals { margin-top: 18px; margin-right: auto; width: 280px; }
  .totals div { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
  .totals .grand { border-top: 2px solid #111827; margin-top: 6px; padding-top: 10px; font-size: 17px; font-weight: 700; }
  .pay { margin-top: 26px; border: 1px dashed #d1d5db; border-radius: 10px; padding: 14px 16px; font-size: 13px; }
  .pay b { font-weight: 600; }
  .notes { margin-top: 18px; font-size: 12px; color: #4b5563; white-space: pre-wrap; }
  .foot { margin-top: 30px; padding-top: 14px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; display: flex; justify-content: space-between; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border-radius: 0; max-width: none; padding: 24px; }
    .hint { display: none; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="top">
      <div class="vendor">
        ${escapeHtml(input.vendorName)}
        <small>${escapeHtml(input.vendorUrl ?? '')}</small>
      </div>
      <div class="doc">
        <h1>فاتورة</h1>
        <div class="number">${escapeHtml(input.number)}</div>
        <span class="badge${input.status === 'paid' ? '' : ' unpaid'}">${escapeHtml(status)}</span>
      </div>
    </div>

    <div class="meta">
      <div><span>فاتورة إلى</span><b>${escapeHtml(input.accountName)}</b></div>
      <div><span>تاريخ الإصدار</span><b>${escapeHtml(formatDate(input.issueDate, timeZone))}</b></div>
      <div><span>تاريخ الاستحقاق</span><b>${escapeHtml(formatDate(input.dueDate, timeZone))}</b></div>
    </div>

    <table>
      <thead>
        <tr><th>البيان</th><th class="num">الكمية</th><th class="num">السعر</th><th class="num">الإجمالي</th></tr>
      </thead>
      <tbody>${rows(items)}</tbody>
    </table>

    <div class="totals">
      <div><span>المجموع</span><span>${escapeHtml(formatMoney(Number(input.amount) - tax, input.currency))}</span></div>
      <div><span>الضريبة</span><span>${escapeHtml(formatMoney(tax, input.currency))}</span></div>
      <div class="grand"><span>الإجمالي</span><span>${escapeHtml(total)}</span></div>
    </div>

    ${
      input.status === 'paid' && input.paidAt
        ? `<div class="pay">
            <b>تم السداد</b> في ${escapeHtml(formatDateTime(input.paidAt, timeZone))}
            ${input.paymentReference ? `<br><b>رقم عملية الدفع:</b> ${escapeHtml(input.paymentReference)}` : ''}
            ${input.paymentPayer ? `<br><b>اسم المرسل:</b> ${escapeHtml(input.paymentPayer)}` : ''}
            ${input.toEmail ? `<br><b>البريد:</b> ${escapeHtml(input.toEmail)}` : ''}
          </div>`
        : ''
    }

    ${input.notes ? `<div class="notes">${escapeHtml(input.notes)}</div>` : ''}

    <div class="foot">
      <span>${escapeHtml(input.vendorName)}${input.vendorUrl ? ` — ${escapeHtml(input.vendorUrl)}` : ''}</span>
      <span class="hint">اطبع هذه الصفحة أو احفظها PDF من المتصفح (Ctrl/Cmd + P)</span>
    </div>
  </div>
</body>
</html>`;
}
