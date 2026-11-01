// ============================================================
// Reports — one place that turns a result into display cells.
//
// Three surfaces render the same table (the screen, the printed A4 page, the
// scheduled email). If each formatted its own values, the CSV would say 31.8
// where the mail says 31.8% and the manager would have to guess which is
// wrong. They all go through here.
// ============================================================

import { UNASSIGNED_AGENT } from './catalog';
import { formatCell, type ReportResult } from './run';

export interface PreparedColumn {
  key: string;
  label: string;
  align: 'start' | 'end';
}

export interface PreparedTable {
  columns: PreparedColumn[];
  rows: string[][];
  totals: string[] | null;
}

export function prepareReportTable(
  result: ReportResult,
  options: {
    locale: string;
    currency?: string;
    labels: Record<string, string>;
    totalsLabel: string;
    agentPlaceholder?: string | null;
  },
): PreparedTable {
  const { locale, currency, labels, totalsLabel } = options;
  const agentLabel = options.agentPlaceholder ?? null;

  // The runner sends a sentinel for "no member"; each surface prints the word.
  const rows = agentLabel
    ? result.rows.map((row) => (row.agent === UNASSIGNED_AGENT ? { ...row, agent: agentLabel } : row))
    : result.rows;

  const context = {
    locale,
    currency,
    dataset: result.dataset,
    grain: result.grain,
    timeZone: result.timeZone,
    agentPlaceholder: agentLabel ?? undefined,
  };

  const columns: PreparedColumn[] = result.columns.map((column) => ({
    key: column.key,
    label: labels[column.key] ?? column.key,
    align: column.kind === 'number' ? 'end' : 'start',
  }));

  const body = rows.map((row) =>
    result.columns.map((column) => formatCell(row[column.key], column, context)),
  );

  const totals =
    result.rows.length > 1
      ? result.columns.map((column, index) =>
          index === 0 ? totalsLabel : formatCell(result.totals[column.key], column, context),
        )
      : null;

  return { columns, rows: body, totals };
}
