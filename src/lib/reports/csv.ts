// ============================================================
// Reports — CSV export.
//
// Two things make an Arabic CSV open correctly in Excel, and both are
// one-line decisions that are wrong by default:
//   1. a UTF-8 BOM, without which Excel on Windows reads the file as ANSI and
//      every Arabic header renders as mojibake;
//   2. CRLF line endings, which is what RFC 4180 specifies and what Excel
//      expects — a bare \n works in LibreOffice and not in Excel.
//
// Numbers are written unformatted (no thousands separators, no currency
// symbol, a dot decimal separator): the file is data, and a locale-formatted
// "١٬٢٠٤" is not a number to any spreadsheet.
// ============================================================

import type { ReportColumn, ReportResult } from './run';

const BOM = '\uFEFF';

export function csvCell(value: unknown): string {
  if (value == null) return '';
  const text = String(value);
  // Quote when the value contains a delimiter, a quote or a newline — and
  // also when it starts with = + - @, because a spreadsheet treats those as
  // a formula (CSV injection: a contact named "=cmd|..." would execute).
  const risky = /[",\r\n]/.test(text) || /^[=+\-@\t]/.test(text);
  if (!risky) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function reportToCsv(
  result: ReportResult,
  headers: Record<string, string>,
): string {
  const columns = result.columns;
  const lines: string[] = [];
  lines.push(columns.map((column) => csvCell(headers[column.key] ?? column.key)).join(','));

  for (const row of result.rows) {
    lines.push(columns.map((column) => csvCell(rawCell(row[column.key], column))).join(','));
  }

  // A totals line, labelled in the first column so it cannot be mistaken for
  // another data row when the file is pivoted.
  if (result.rows.length > 1) {
    lines.push(
      columns
        .map((column, index) =>
          index === 0 ? csvCell(headers.__totals ?? 'Total') : csvCell(rawCell(result.totals[column.key], column)),
        )
        .join(','),
    );
  }

  return BOM + lines.join('\r\n') + '\r\n';
}

/**
 * What actually goes in the file. A timestamp keeps its ISO form (sortable,
 * unambiguous, still readable in Excel); a number stays unformatted.
 */
function rawCell(value: unknown, column: ReportColumn): string | number {
  if (value == null) return '';
  if (column.kind === 'number') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : String(value);
  }
  return String(value);
}

/**
 * `Content-Disposition` for a file with an Arabic name.
 *
 * A response header is a ByteString: putting «أداء» in it throws
 * `Cannot convert argument to a ByteString`. RFC 5987 solves it — an ASCII
 * fallback for old clients plus the percent-encoded real name for everyone
 * else.
 */
export function contentDisposition(filename: string, fallback: string): string {
  const ascii = fallback.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'report.csv';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function reportFileName(result: ReportResult, slug: string): string {
  // Only the characters a file system refuses are removed: NFKD would strip
  // the hamza off «أداء» and quietly rename the manager's report.
  const safe = slug
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${safe || result.dataset}-${result.from}-${result.to}.csv`;
}
