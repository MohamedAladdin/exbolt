'use client';

// ============================================================
// Report builder controls.
//
// Renders itself from the catalogue (`src/lib/reports/catalog.ts`), so the
// dataset determines which metrics, dimensions and filters even exist —
// there is no second list of options to forget to update.
//
// Advanced metrics are visible but disabled when the plan lacks
// `reports_advanced`: a manager needs to know the number exists to want it,
// and the server refuses it anyway (§/api/reports/run).
// ============================================================

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  DATASETS,
  GRAINS,
  MAX_REPORT_DAYS,
  REPORT_DATASETS,
  addDays,
  daysBetween,
  type DimensionKey,
  type FilterKey,
  type Grain,
  type ReportConfig,
  type ReportDataset,
} from '@/lib/reports/catalog';

export interface Option {
  value: string;
  label: string;
}

export interface ReportOptions {
  agents: Option[];
  tags: Option[];
  pipelines: Option[];
  stages: Option[];
  numbers: Option[];
  broadcasts: Option[];
}

const CHANNELS = ['whatsapp', 'messenger', 'instagram'] as const;

const STATUSES: Partial<Record<ReportDataset, string[]>> = {
  messages: ['sending', 'sent', 'delivered', 'read', 'failed'],
  conversations: ['open', 'pending', 'closed'],
  deals: ['open', 'active', 'won', 'lost'],
  broadcasts: ['draft', 'scheduled', 'sending', 'sent', 'failed'],
};

const RANGE_SHORTCUTS = [7, 30, 90] as const;

export function ReportControls({
  config,
  onChange,
  onRun,
  running,
  advanced,
  options,
  canRun,
}: {
  config: ReportConfig;
  onChange: (next: ReportConfig) => void;
  onRun: () => void;
  running: boolean;
  advanced: boolean;
  options: ReportOptions;
  canRun: boolean;
}) {
  const t = useTranslations('Reports');
  const def = DATASETS[config.dataset];
  const days = daysBetween(config.from, config.to);

  const patch = (next: Partial<ReportConfig>) => onChange({ ...config, ...next });

  const setDataset = (dataset: ReportDataset) => {
    const nextDef = DATASETS[dataset];
    onChange({
      ...config,
      dataset,
      metrics: nextDef.defaultMetrics,
      dimensions: nextDef.defaultDimensions,
      // Filters are dataset-specific: keeping a `pipeline` filter while
      // switching to messages would make the run fail with a 400.
      filters: {},
    });
  };

  const toggleMetric = (key: string) => {
    const has = config.metrics.includes(key);
    patch({
      metrics: has ? config.metrics.filter((m) => m !== key) : [...config.metrics, key],
    });
  };

  const toggleDimension = (key: DimensionKey) => {
    const has = config.dimensions.includes(key);
    patch({
      dimensions: has
        ? config.dimensions.filter((d) => d !== key)
        : // Two breakdowns is the readable maximum: a third turns the table
          // into a spreadsheet nobody can scan.
          [...config.dimensions, key].slice(0, 2),
    });
  };

  const setFilter = (key: FilterKey, values: string[]) => {
    const filters = { ...config.filters };
    if (values.length === 0) delete filters[key];
    else filters[key] = values;
    patch({ filters });
  };

  const toggleFilterValue = (key: FilterKey, value: string) => {
    const current = config.filters[key] ?? [];
    setFilter(
      key,
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };

  return (
    <div className="space-y-5">
      {/* dataset */}
      <div className="flex flex-wrap gap-2">
        {REPORT_DATASETS.map((dataset) => (
          <button
            key={dataset}
            type="button"
            onClick={() => setDataset(dataset)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition',
              config.dataset === dataset
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {t(`datasets.${dataset}`)}
          </button>
        ))}
      </div>

      {/* period */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('period.from')}</span>
          <Input
            type="date"
            dir="ltr"
            value={config.from}
            max={config.to}
            onChange={(event) => {
              const from = event.target.value;
              if (!from) return;
              if (daysBetween(from, config.to) > MAX_REPORT_DAYS) return;
              patch({ from });
            }}
            className="h-9 w-[9.5rem]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('period.to')}</span>
          <Input
            type="date"
            dir="ltr"
            value={config.to}
            min={config.from}
            onChange={(event) => {
              const to = event.target.value;
              if (!to) return;
              if (daysBetween(config.from, to) > MAX_REPORT_DAYS) return;
              patch({ to });
            }}
            className="h-9 w-[9.5rem]"
          />
        </label>

        <div className="flex gap-1.5">
          {RANGE_SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut}
              type="button"
              onClick={() => patch({ from: addDays(config.to, -(shortcut - 1)) })}
              className={cn(
                'h-9 rounded-md border px-2.5 text-xs transition',
                days === shortcut
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t('period.days', { count: shortcut })}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('grain.label')}</span>
          <select
            value={config.grain}
            onChange={(event) => patch({ grain: event.target.value as Grain })}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            {GRAINS.map((grain) => (
              <option key={grain} value={grain}>
                {t(`grain.${grain}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* metrics */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">{t('metricsLabel')}</span>
        <div className="flex flex-wrap gap-1.5">
          {def.metrics.map((metric) => {
            const locked = metric.advanced === true && !advanced;
            const active = config.metrics.includes(metric.key);
            return (
              <button
                key={metric.key}
                type="button"
                disabled={locked}
                title={locked ? t('advancedOnly') : undefined}
                onClick={() => toggleMetric(metric.key)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                  locked && 'cursor-not-allowed opacity-50',
                )}
              >
                {locked && <Lock className="size-3" />}
                {t(`metrics.${metric.key}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* dimensions */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t('dimensionsLabel')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {def.dimensions.map((dimension) => {
            const active = config.dimensions.includes(dimension);
            return (
              <button
                key={dimension}
                type="button"
                onClick={() => toggleDimension(dimension)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`dimensions.${dimension}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* filters */}
      <div className="space-y-3">
        <span className="text-xs font-medium text-muted-foreground">{t('filtersLabel')}</span>

        {def.filters.includes('channel') && (
          <FilterRow label={t('filters.channel')}>
            {CHANNELS.map((channel) => (
              <Chip
                key={channel}
                active={(config.filters.channel ?? []).includes(channel)}
                onClick={() => toggleFilterValue('channel', channel)}
              >
                {t(`channels.${channel}`)}
              </Chip>
            ))}
          </FilterRow>
        )}

        {def.filters.includes('status') && (
          <FilterRow label={t('filters.status')}>
            {(STATUSES[config.dataset] ?? []).map((status) => (
              <Chip
                key={status}
                active={(config.filters.status ?? []).includes(status)}
                onClick={() => toggleFilterValue('status', status)}
              >
                {t(`statuses.${status}`)}
              </Chip>
            ))}
          </FilterRow>
        )}

        {def.filters.includes('agent') && options.agents.length > 0 && (
          <FilterRow label={t('filters.agent')} scroll>
            {options.agents.map((agent) => (
              <Chip
                key={agent.value}
                active={(config.filters.agent ?? []).includes(agent.value)}
                onClick={() => toggleFilterValue('agent', agent.value)}
              >
                {agent.label}
              </Chip>
            ))}
          </FilterRow>
        )}

        {def.filters.includes('tag') && options.tags.length > 0 && (
          <FilterRow label={t('filters.tag')} scroll>
            {options.tags.map((tag) => (
              <Chip
                key={tag.value}
                active={(config.filters.tag ?? []).includes(tag.value)}
                onClick={() => toggleFilterValue('tag', tag.value)}
              >
                {tag.label}
              </Chip>
            ))}
          </FilterRow>
        )}

        {def.filters.includes('pipeline') && options.pipelines.length > 1 && (
          <FilterRow label={t('filters.pipeline')}>
            {options.pipelines.map((pipeline) => (
              <Chip
                key={pipeline.value}
                active={(config.filters.pipeline ?? []).includes(pipeline.value)}
                onClick={() => toggleFilterValue('pipeline', pipeline.value)}
              >
                {pipeline.label}
              </Chip>
            ))}
          </FilterRow>
        )}

        {def.filters.includes('stage') && options.stages.length > 0 && (
          <FilterRow label={t('filters.stage')} scroll>
            {options.stages.map((stage) => (
              <Chip
                key={stage.value}
                active={(config.filters.stage ?? []).includes(stage.value)}
                onClick={() => toggleFilterValue('stage', stage.value)}
              >
                {stage.label}
              </Chip>
            ))}
          </FilterRow>
        )}

        {def.filters.includes('broadcast') && options.broadcasts.length > 0 && (
          <FilterRow label={t('filters.broadcast')} scroll>
            {options.broadcasts.map((broadcast) => (
              <Chip
                key={broadcast.value}
                active={(config.filters.broadcast ?? []).includes(broadcast.value)}
                onClick={() => toggleFilterValue('broadcast', broadcast.value)}
              >
                {broadcast.label}
              </Chip>
            ))}
          </FilterRow>
        )}

        {def.filters.includes('number') && options.numbers.length > 1 && (
          <FilterRow label={t('filters.number')}>
            {options.numbers.map((number) => (
              <Chip
                key={number.value}
                active={(config.filters.number ?? []).includes(number.value)}
                onClick={() => toggleFilterValue('number', number.value)}
              >
                {number.label}
              </Chip>
            ))}
          </FilterRow>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={onRun} disabled={running || !canRun}>
          {running ? t('running') : t('run')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t('periodLabel', { from: config.from, to: config.to })}
        </span>
      </div>
    </div>
  );
}

function FilterRow({
  label,
  children,
  scroll,
}: {
  label: string;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <span className="mt-1 w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className={cn('flex flex-wrap gap-1.5', scroll && 'max-h-20 overflow-y-auto')}>
        {children}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] transition',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
