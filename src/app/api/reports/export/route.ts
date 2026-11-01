// ============================================================
// /api/reports/export — download a report as CSV or a printable A4 page.
//
// POST rather than GET because the config is a body: the same config object
// runs the report and prints it, so the file can never disagree with the
// screen it was exported from.
//
// The browser does the PDF step (Ctrl/⌘+P → Save as PDF) because no PDF
// engine ships in the image and Arabic needs shaping plus an embedded font.
// A self-contained A4 HTML page gets that right offline and prints to a
// usable document on every platform.
//
// Labels arrive from the client (the UI already holds the translations) and
// are HTML-escaped / CSV-quoted on the way out — a report titled
// `<img onerror=…>` prints as text.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { VENDOR_NAME, VENDOR_URL, brandName } from '@/lib/branding';
import { requireFeature } from '@/lib/plans/guard';
import {
  ReportConfigError,
  browserTimeZone,
  normalizeReportConfig,
  todayIn,
} from '@/lib/reports/catalog';
import { contentDisposition, reportFileName, reportToCsv } from '@/lib/reports/csv';
import { renderReportHtml, type ReportDocumentColumn } from '@/lib/reports/document';
import { ReportRunError, formatCell, runReport } from '@/lib/reports/run';

interface ExportLabels {
  title: string;
  subtitle?: string | null;
  columns: Record<string, string>;
  totals: string;
  period: string;
  generated: string;
  rowCount: string;
  truncated: string;
  footer?: string | null;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireFeature('exports');
    const body = (await request.json().catch(() => null)) as
      | { config?: unknown; format?: unknown; locale?: unknown; labels?: unknown; currency?: unknown }
      | null;

    const allowAdvanced = ctx.entitlements.features.reports_advanced !== false;
    let config;
    try {
      config = normalizeReportConfig(body?.config, {
        today: todayIn(browserTimeZone()),
        timeZone: browserTimeZone(),
        allowAdvanced,
      });
    } catch (err) {
      if (err instanceof ReportConfigError) {
        return NextResponse.json({ error: err.code, detail: err.message }, { status: 400 });
      }
      throw err;
    }

    const labels = (body?.labels ?? null) as ExportLabels | null;
    if (!labels || typeof labels !== 'object' || typeof labels.title !== 'string') {
      return NextResponse.json({ error: 'missing_labels' }, { status: 400 });
    }

    const format = body?.format === 'html' ? 'html' : 'csv';
    const locale = typeof body?.locale === 'string' ? body.locale : 'ar';
    const currency = typeof body?.currency === 'string' ? body.currency : undefined;

    let result;
    try {
      result = await runReport(ctx.supabase, config);
    } catch (err) {
      if (err instanceof ReportRunError) {
        return NextResponse.json({ error: 'invalid_report', detail: err.message }, { status: 400 });
      }
      throw err;
    }

    const headers: Record<string, string> = {};
    for (const column of result.columns) {
      headers[column.key] = String(labels.columns?.[column.key] ?? column.key).slice(0, 80);
    }
    headers.__totals = String(labels.totals ?? 'Total').slice(0, 80);

    if (format === 'csv') {
      const csv = reportToCsv(result, headers);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': contentDisposition(
            reportFileName(result, labels.title),
            `${result.dataset}-${result.from}-${result.to}.csv`,
          ),
          'Cache-Control': 'no-store',
        },
      });
    }

    const cellContext = {
      locale,
      currency,
      dataset: result.dataset,
      grain: result.grain,
      timeZone: result.timeZone,
    };

    const columns: ReportDocumentColumn[] = result.columns.map((column) => ({
      key: column.key,
      label: headers[column.key],
      align: column.kind === 'number' ? 'end' : 'start',
    }));

    const rows = result.rows.map((row) =>
      result.columns.map((column) => formatCell(row[column.key], column, cellContext)),
    );

    const totals = result.columns.map((column, index) =>
      index === 0 ? '' : formatCell(result.totals[column.key], column, cellContext),
    );

    const html = renderReportHtml({
      title: String(labels.title).slice(0, 120),
      subtitle: labels.subtitle ? String(labels.subtitle).slice(0, 160) : null,
      brandName: brandName(ctx.account.name),
      vendorName: VENDOR_NAME,
      vendorUrl: VENDOR_URL,
      locale,
      periodLabel: String(labels.period ?? '').slice(0, 160),
      generatedAtLabel: String(labels.generated ?? '').slice(0, 160),
      columns,
      rows,
      totals: result.rows.length > 1 ? totals : null,
      totalsLabel: headers.__totals,
      rowCountLabel: String(labels.rowCount ?? '').slice(0, 80),
      truncated: result.truncated,
      truncatedLabel: String(labels.truncated ?? '').slice(0, 200),
      footerNote: labels.footer ? String(labels.footer).slice(0, 300) : null,
    });

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
