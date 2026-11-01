// ============================================================
// Reports — printable A4 document.
//
// Same reasoning as the invoice document: there is no PDF engine in the
// image, and hand-rolling Arabic PDF output means font embedding plus
// shaping — a naive generator prints disconnected, reversed glyphs. A
// self-contained HTML page that the browser prints to PDF gets Arabic
// shaping right for free, offline, with no dependency.
//
// Everything that came from the database or from a saved report name is
// HTML-escaped here: the document is served as text/html and a contact can
// be called `<b>`.
// ============================================================

import { escapeHtml } from '@/lib/billing/invoice-document';

export interface ReportDocumentColumn {
  key: string;
  label: string;
  /** `start` for the label column, `end` for numbers (RTL-aware). */
  align: 'start' | 'end';
}

export interface ReportDocumentInput {
  title: string;
  subtitle?: string | null;
  brandName: string;
  /** Public logo URL; only http(s) is emitted (a `javascript:` URL is dropped). */
  logoUrl?: string | null;
  vendorName: string;
  vendorUrl?: string | null;
  locale: string;
  periodLabel: string;
  generatedAtLabel: string;
  columns: ReportDocumentColumn[];
  /** Fully formatted cells, in `columns` order. */
  rows: string[][];
  totals?: string[] | null;
  totalsLabel: string;
  rowCountLabel: string;
  truncated: boolean;
  truncatedLabel: string;
  footerNote?: string | null;
}

/** Only an http(s) URL may reach an `<img src>`; anything else is dropped. */
function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

export function renderReportHtml(input: ReportDocumentInput): string {
  const rtl = input.locale.startsWith('ar');
  const dir = rtl ? 'rtl' : 'ltr';

  const head = input.columns
    .map(
      (column) =>
        `<th class="${column.align === 'end' ? 'num' : 'txt'}">${escapeHtml(column.label)}</th>`,
    )
    .join('');

  const body = input.rows
    .map(
      (cells) =>
        `<tr>${input.columns
          .map(
            (column, index) =>
              `<td class="${column.align === 'end' ? 'num' : 'txt'}">${escapeHtml(cells[index] ?? '')}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');

  const totalsRow = input.totals
    ? `<tfoot><tr>${input.columns
        .map(
          (column, index) =>
            `<td class="${column.align === 'end' ? 'num' : 'txt'}">${escapeHtml(
              index === 0 ? input.totalsLabel : (input.totals?.[index] ?? ''),
            )}</td>`,
        )
        .join('')}</tr></tfoot>`
    : '';

  return `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font-family: "Segoe UI", Tahoma, "Noto Naskh Arabic", Arial, sans-serif;
    color: #111827; background: #eef1f5; direction: ${dir};
  }
  .sheet {
    background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto;
    padding: 18mm 14mm; box-shadow: 0 1px 3px rgba(0,0,0,.14);
  }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .brand { font-size: 18px; font-weight: 700; letter-spacing: .2px; }
  .brand img.logo { display: block; max-height: 14mm; max-width: 55mm; object-fit: contain; margin-bottom: 3mm; }
  .brand small { display: block; font-weight: 500; font-size: 11px; color: #6b7280; margin-top: 2px; }
  .meta { font-size: 11px; color: #4b5563; text-align: ${rtl ? 'left' : 'right'}; line-height: 1.7; }
  h1 { font-size: 20px; margin: 18px 0 2px; }
  .sub { font-size: 12px; color: #6b7280; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 10px; }
  thead th {
    background: #f3f4f6; color: #111827; font-weight: 600; padding: 8px 9px;
    border-bottom: 1.5px solid #d1d5db; white-space: nowrap;
  }
  tbody td, tfoot td { padding: 7px 9px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  tfoot td { font-weight: 700; background: #f3f4f6; border-top: 1.5px solid #d1d5db; }
  .num { text-align: ${rtl ? 'left' : 'right'}; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .txt { text-align: ${rtl ? 'right' : 'left'}; }
  .note { margin-top: 14px; font-size: 10.5px; color: #6b7280; line-height: 1.7; }
  .flag { color: #b45309; font-weight: 600; }
  footer {
    margin-top: 22px; padding-top: 10px; border-top: 1px solid #e5e7eb;
    font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between;
  }
  @page { size: A4; margin: 12mm; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; width: auto; min-height: auto; padding: 0; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <header>
      <div class="brand">
        ${safeImageUrl(input.logoUrl) ? `<img class="logo" src="${escapeHtml(safeImageUrl(input.logoUrl))}" alt="">` : ''}
        ${escapeHtml(input.brandName)}
        <small>${escapeHtml(input.vendorName)}${
          input.vendorUrl ? ` · ${escapeHtml(input.vendorUrl)}` : ''
        }</small>
      </div>
      <div class="meta">
        <div>${escapeHtml(input.periodLabel)}</div>
        <div>${escapeHtml(input.generatedAtLabel)}</div>
        <div>${escapeHtml(input.rowCountLabel)}</div>
      </div>
    </header>

    <h1>${escapeHtml(input.title)}</h1>
    ${input.subtitle ? `<div class="sub">${escapeHtml(input.subtitle)}</div>` : '<div class="sub"></div>'}

    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
      ${totalsRow}
    </table>

    ${input.truncated ? `<div class="note flag">${escapeHtml(input.truncatedLabel)}</div>` : ''}
    ${input.footerNote ? `<div class="note">${escapeHtml(input.footerNote)}</div>` : ''}

    <footer>
      <span>${escapeHtml(input.vendorName)}</span>
      <span>${escapeHtml(input.generatedAtLabel)}</span>
    </footer>
  </div>
</body>
</html>`;
}
