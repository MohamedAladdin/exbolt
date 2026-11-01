// ============================================================
// Reports — running one and reading the answer.
//
// `run_report` (migration 082) returns a shape the UI renders generically:
//   columns → header order and type (time | text | number)
//   rows    → one object per group, keyed by column key
//   totals  → the same metric keys aggregated over the whole filtered set
//
// Keeping the formatting here (and not in the components) means the table,
// the CSV and the printable document all print `42%`, `1,204` and `EGP 300`
// identically — a report that says 0.318 on screen and 31.8 in the export is
// the kind of bug a manager finds before we do.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { MetricUnit, ReportConfig, ReportDataset } from './catalog';
import { metricUnit } from './catalog';

export type ColumnKind = 'time' | 'text' | 'number';

export interface ReportColumn {
  key: string;
  kind: ColumnKind;
}

export type ReportRow = Record<string, string | number | null>;
export type ReportTotals = Record<string, number | string | null>;

export interface ReportResult {
  dataset: ReportDataset;
  from: string;
  to: string;
  timeZone: string;
  grain: 'day' | 'week' | 'month';
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportTotals;
  rowCount: number;
  truncated: boolean;
  limit: number;
}

export class ReportRunError extends Error {
  readonly status = 400 as const;
  constructor(message: string) {
    super(message);
    this.name = 'ReportRunError';
  }
}

export async function runReport(
  supabase: SupabaseClient,
  config: ReportConfig,
): Promise<ReportResult> {
  const { data, error } = await supabase.rpc('run_report', { p_config: config });
  if (error) {
    // The RPC raises 22023 for a config it refuses (unknown metric/dimension
    // for this dataset). That is the caller's mistake, not a server fault,
    // so it must not surface as a 500.
    const code = (error as { code?: string }).code;
    if (code === '22023' || /does not apply|unknown (metric|dimension|report)/i.test(error.message)) {
      throw new ReportRunError(error.message);
    }
    throw error;
  }
  return data as ReportResult;
}

/** Value with the unit it was measured in — never a bare number in a table. */
export function formatMetric(
  value: unknown,
  unit: MetricUnit,
  { locale, currency }: { locale: string; currency?: string },
): string {
  if (value == null || value === '') return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);

  if (unit === 'percent') {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(numeric)}%`;
  }
  if (unit === 'money') {
    const code = currency ?? 'USD';
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code,
        maximumFractionDigits: 2,
      }).format(numeric);
    } catch {
      return `${new Intl.NumberFormat(locale).format(numeric)} ${code}`;
    }
  }
  if (unit === 'minutes') {
    return formatDuration(numeric, locale);
  }
  if (unit === 'days') {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(numeric)}`;
  }
  return new Intl.NumberFormat(locale).format(numeric);
}

/**
 * Minutes as a human duration. A median first response of 1,626 minutes is
 * technically true and useless; "1 ي 3 س" is what the manager repeats in a
 * meeting.
 */
export function formatDuration(minutes: number, locale: string): string {
  if (!Number.isFinite(minutes)) return '—';
  const rounded = Math.round(minutes * 10) / 10;
  const ar = locale.startsWith('ar');
  if (rounded < 1) return ar ? 'أقل من دقيقة' : '< 1 min';
  if (rounded < 60) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(rounded)} ${ar ? 'د' : 'min'}`;
  }
  const days = Math.floor(rounded / 1440);
  const hours = Math.floor((rounded % 1440) / 60);
  const mins = Math.round(rounded % 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} ${ar ? 'ي' : 'd'}`);
  if (hours) parts.push(`${hours} ${ar ? 'س' : 'h'}`);
  if (!days && mins) parts.push(`${mins} ${ar ? 'د' : 'min'}`);
  return parts.join(' ');
}

/** Period bucket label. Day = short date, week/month = the bucket's start. */
export function formatPeriod(
  value: unknown,
  grain: 'day' | 'week' | 'month',
  { locale, timeZone }: { locale: string; timeZone: string },
): string {
  if (value == null) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const base = { timeZone, day: 'numeric', month: 'short' } as const;
  const options: Intl.DateTimeFormatOptions =
    grain === 'day'
      ? { ...base }
      : grain === 'week'
        ? { ...base, year: 'numeric' }
        : { timeZone, month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatCell(
  value: unknown,
  column: ReportColumn,
  context: {
    locale: string;
    currency?: string;
    dataset: ReportDataset;
    grain: 'day' | 'week' | 'month';
    timeZone: string;
  },
): string {
  if (column.kind === 'time') {
    return formatPeriod(value, context.grain, context);
  }
  if (column.kind === 'number') {
    return formatMetric(value, metricUnit(context.dataset, column.key), context);
  }
  return value == null || value === '' ? '—' : String(value);
}
