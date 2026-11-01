'use client';

// ============================================================
// Report results — chart, table, totals, exports.
//
// One renderer for every dataset: the columns arrive typed (time | text |
// number) and the metric unit comes from the catalogue, so `read_rate`
// prints as 31.8% wherever it appears instead of as 31.8.
//
// Deliberate choices:
//   * the chart is limited to the first three number metrics and is hidden
//     for a tag/status breakdown with one metric — a one-bar chart is
//     decoration, the table already says it;
//   * the table is horizontally scrollable rather than truncated: dropping a
//     column silently is how a report lies;
//   * the totals row is rendered even when the report has a single row (it
//     then equals the row), because "what is the total" is the first question
//     asked of any breakdown.
// ============================================================

import { Download, FileText, Loader2, Save } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { BarChart } from '@/components/tremor/bar-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { agentPlaceholderKey, metricUnit } from '@/lib/reports/catalog';
import { compare } from '@/lib/dashboard/overview';
import { formatCell, formatMetric, lowerIsBetter, type ReportResult } from '@/lib/reports/run';

export function ReportResults({
  result,
  currency,
  canSave,
  saving,
  exporting,
  onSave,
  onExport,
}: {
  result: ReportResult | null;
  currency: string;
  canSave: boolean;
  saving: boolean;
  exporting: 'csv' | 'html' | null;
  onSave: () => void;
  onExport: (format: 'csv' | 'html') => void;
}) {
  const t = useTranslations('Reports');
  const locale = useLocale();

  if (!result) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {t('emptyPrompt')}
      </div>
    );
  }

  const context = {
    locale,
    currency,
    dataset: result.dataset,
    grain: result.grain,
    timeZone: result.timeZone,
    agentPlaceholder: t(`agentPlaceholder.${agentPlaceholderKey(result.dataset)}`),
  };

  const columns = result.columns;
  const unitOf = (key: string) => metricUnit(result.dataset, key);
  const numberColumns = columns.filter((column) => column.kind === 'number');
  const labelColumn = columns.find((column) => column.kind !== 'number') ?? columns[0];

  // One unit per chart. A report can mix messages (count) with a delivery
  // rate (percent); plotting both on one axis makes the percentage invisible.
  const chartUnit = numberColumns[0] ? unitOf(numberColumns[0].key) : 'count';
  const chartColumns = numberColumns
    .filter((column) => unitOf(column.key) === chartUnit)
    .slice(0, 3);
  const chartData = result.rows.slice(0, 60).map((row) => {
    const entry: Record<string, string | number> = {
      label: formatCell(row[labelColumn.key], labelColumn, context),
    };
    for (const column of chartColumns) {
      const value = Number(row[column.key] ?? 0);
      entry[t(`metrics.${column.key}`)] = Number.isFinite(value) ? value : 0;
    }
    return entry;
  });

  const showChart =
    chartColumns.length > 0 &&
    result.rows.length > 1 &&
    !(chartColumns.length === 1 && columns.length === 2 && result.rows.length < 3);

  const valueFormatter = (value: number) =>
    formatMetric(value, unitOf(chartColumns[0]?.key ?? ''), { locale, currency });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <div className="font-medium">{t(`datasets.${result.dataset}`)}</div>
          <div className="text-xs text-muted-foreground">
            {t('periodLabel', { from: result.from, to: result.to })} ·{' '}
            {t('rowsCount', { count: result.rowCount })} · {result.timeZone}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting !== null}
            onClick={() => onExport('csv')}
          >
            {exporting === 'csv' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {t('exportCsv')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting !== null}
            onClick={() => onExport('html')}
          >
            {exporting === 'html' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileText className="size-4" />
            )}
            {t('exportPrint')}
          </Button>
          <Button type="button" size="sm" disabled={!canSave || saving} onClick={onSave}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t('save')}
          </Button>
        </div>
      </div>

      {result.previous && numberColumns.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {numberColumns.slice(0, 4).map((column) => {
            const current = result.totals[column.key];
            const previous = result.previous?.totals?.[column.key] ?? null;
            const change = compare(
              current == null ? null : Number(current),
              previous == null ? null : Number(previous),
              lowerIsBetter(result.dataset, column.key),
            );
            const tone =
              change.tone === 'good'
                ? 'text-emerald-600 dark:text-emerald-400'
                : change.tone === 'bad'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-muted-foreground';
            const arrow =
              change.trend === 'up' ? '▲' : change.trend === 'down' ? '▼' : '＝';
            return (
              <div key={column.key} className="rounded-lg border border-border p-3">
                <div className="text-[11px] text-muted-foreground">
                  {t(`metrics.${column.key}`)}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-semibold tabular-nums">
                    {formatMetric(current, unitOf(column.key), { locale, currency })}
                  </span>
                  <span className={cn('text-xs font-medium tabular-nums', tone)}>
                    {arrow} {change.percent == null ? t('compare.new') : `${Math.abs(change.percent)}%`}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {t('compare.previousValue', {
                    value: formatMetric(previous, unitOf(column.key), { locale, currency }),
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {result.truncated && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t('truncated', { count: result.limit })}
        </div>
      )}

      {result.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <>
          {showChart && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t('chartTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <BarChart
                  className="h-56"
                  data={chartData}
                  index="label"
                  categories={chartColumns.map((column) => t(`metrics.${column.key}`))}
                  colors={['blue', 'emerald', 'violet']}
                  valueFormatter={valueFormatter}
                  showLegend={chartColumns.length > 1}
                  yAxisWidth={48}
                  allowDecimals
                />
              </CardContent>
            </Card>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={cn(
                        'whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground',
                        column.kind === 'number' ? 'text-end' : 'text-start',
                      )}
                    >
                      {column.kind === 'number'
                        ? t(`metrics.${column.key}`)
                        : column.key === 'period'
                          ? t('dimensions.period')
                          : t(`dimensions.${column.key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index} className="border-t border-border/60">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          'px-3 py-2',
                          column.kind === 'number'
                            ? 'text-end tabular-nums'
                            : 'text-start',
                        )}
                      >
                        {formatCell(row[column.key], column, context)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/40">
                <tr>
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(
                        'border-t border-border px-3 py-2 font-semibold',
                        column.kind === 'number' ? 'text-end tabular-nums' : 'text-start',
                      )}
                    >
                      {index === 0
                        ? t('totals')
                        : column.kind === 'number'
                          ? formatMetric(result.totals[column.key], unitOf(column.key), {
                              locale,
                              currency,
                            })
                          : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
