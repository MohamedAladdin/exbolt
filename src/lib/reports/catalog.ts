// ============================================================
// Reports — the catalogue.
//
// This module is the single source of truth for WHAT a report can ask.
// The runner (`run_report`, migration 082) enforces the same vocabulary on
// the server; the builder UI renders itself from these definitions so a new
// metric is one entry here plus one branch in the SQL, never a new screen.
//
// Rules this file exists to keep:
//   * A metric name means ONE thing. `read` is always "outbound messages the
//     customer opened", never "messages with status read" (which would count
//     inbound messages and produce a delivery rate above 100%).
//   * Every option carries the unit it is displayed in, so the table never
//     has to guess between 42, 42% and $42.
//   * Validation is pure and throws a typed error: the API route maps it to
//     400, the UI calls it before submitting so the user sees the problem in
//     the same tick instead of after a round trip.
// ============================================================

export const REPORT_DATASETS = [
  'messages',
  'conversations',
  'contacts',
  'deals',
  'broadcasts',
  'team',
] as const;

export type ReportDataset = (typeof REPORT_DATASETS)[number];

export type MetricUnit = 'count' | 'percent' | 'money' | 'minutes' | 'days';
export type DimensionKey =
  | 'period'
  | 'channel'
  | 'agent'
  | 'status'
  | 'tag'
  | 'number'
  | 'pipeline'
  | 'stage'
  | 'broadcast';

export type FilterKey =
  | 'channel'
  | 'status'
  | 'agent'
  | 'tag'
  | 'pipeline'
  | 'stage'
  | 'broadcast'
  | 'number';

export interface MetricDef {
  key: string;
  unit: MetricUnit;
  /** Only offered on plans with `reports_advanced`. */
  advanced?: boolean;
}

export interface DatasetDef {
  key: ReportDataset;
  metrics: MetricDef[];
  dimensions: DimensionKey[];
  filters: FilterKey[];
  /** Metrics a report gets when the caller asks for none. */
  defaultMetrics: string[];
  /** Dimensions a report gets when the caller asks for none. */
  defaultDimensions: DimensionKey[];
}

export const GRAINS = ['day', 'week', 'month'] as const;
export type Grain = (typeof GRAINS)[number];

export interface ReportFilters {
  channel?: string[];
  status?: string[];
  agent?: string[];
  tag?: string[];
  pipeline?: string[];
  stage?: string[];
  broadcast?: string[];
  number?: string[];
}

export interface ReportConfig {
  dataset: ReportDataset;
  metrics: string[];
  dimensions: DimensionKey[];
  grain: Grain;
  /** Inclusive `YYYY-MM-DD` in `tz`. */
  from: string;
  to: string;
  tz: string;
  filters: ReportFilters;
  limit: number;
}

/**
 * What the SQL runner returns instead of a name when a row has no member.
 *
 * NULL means something different in each dataset — a customer-sent message, an
 * unassigned conversation, a reply whose sender was never recorded — so the
 * label is chosen per dataset instead of printing one dash for all three.
 */
export const UNASSIGNED_AGENT = '__none';

/** i18n key (under `Reports.agentPlaceholder`) for the nameless member row. */
export function agentPlaceholderKey(dataset: ReportDataset): string {
  switch (dataset) {
    case 'messages':
      return 'customer';
    case 'conversations':
    case 'deals':
      return 'unassigned';
    default:
      return 'noSender';
  }
}

export const MAX_REPORT_DAYS = 366;
export const MAX_REPORT_ROWS = 5000;
export const DEFAULT_REPORT_ROWS = 1000;

/** Typed validation failure — the route answers 400, never 500. */
export class ReportConfigError extends Error {
  readonly code: string;
  readonly status = 400 as const;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'ReportConfigError';
    this.code = code;
  }
}

const count: MetricUnit = 'count';

export const DATASETS: Record<ReportDataset, DatasetDef> = {
  messages: {
    key: 'messages',
    defaultMetrics: ['messages', 'inbound', 'outbound', 'failed'],
    defaultDimensions: ['period'],
    metrics: [
      { key: 'messages', unit: count },
      { key: 'inbound', unit: count },
      { key: 'outbound', unit: count },
      { key: 'delivered', unit: count },
      { key: 'read', unit: count },
      { key: 'failed', unit: count },
      { key: 'ai_replies', unit: count, advanced: true },
      { key: 'delivery_rate', unit: 'percent' },
    ],
    dimensions: ['period', 'agent', 'channel', 'status', 'tag', 'number'],
    filters: ['channel', 'status', 'agent', 'tag', 'number'],
  },
  conversations: {
    key: 'conversations',
    defaultMetrics: ['conversations', 'closed', 'first_response_avg'],
    defaultDimensions: ['period'],
    metrics: [
      { key: 'conversations', unit: count },
      { key: 'open', unit: count },
      { key: 'closed', unit: count },
      { key: 'unassigned', unit: count },
      { key: 'with_reply', unit: count, advanced: true },
      { key: 'first_response_avg', unit: 'minutes', advanced: true },
      { key: 'days_to_close_avg', unit: 'days', advanced: true },
    ],
    dimensions: ['period', 'agent', 'channel', 'status', 'tag', 'number'],
    filters: ['channel', 'status', 'agent', 'tag', 'number'],
  },
  contacts: {
    key: 'contacts',
    defaultMetrics: ['contacts'],
    defaultDimensions: ['period'],
    metrics: [
      { key: 'contacts', unit: count },
      { key: 'with_tag', unit: count, advanced: true },
    ],
    dimensions: ['period', 'channel', 'tag'],
    filters: ['channel', 'tag'],
  },
  deals: {
    key: 'deals',
    defaultMetrics: ['deals', 'won', 'won_value'],
    defaultDimensions: ['period'],
    metrics: [
      { key: 'deals', unit: count },
      { key: 'won', unit: count },
      { key: 'lost', unit: count },
      { key: 'active', unit: count },
      { key: 'value', unit: 'money' },
      { key: 'won_value', unit: 'money' },
      { key: 'avg_value', unit: 'money', advanced: true },
      { key: 'days_to_close_avg', unit: 'days', advanced: true },
    ],
    dimensions: ['period', 'pipeline', 'stage', 'status', 'agent', 'tag'],
    filters: ['status', 'agent', 'tag', 'pipeline', 'stage'],
  },
  broadcasts: {
    key: 'broadcasts',
    defaultMetrics: ['broadcasts', 'delivered', 'read', 'replied'],
    defaultDimensions: ['broadcast'],
    metrics: [
      { key: 'broadcasts', unit: count },
      { key: 'recipients', unit: count },
      { key: 'sent', unit: count },
      { key: 'delivered', unit: count },
      { key: 'read', unit: count },
      { key: 'replied', unit: count },
      { key: 'failed', unit: count },
      { key: 'read_rate', unit: 'percent' },
      { key: 'reply_rate', unit: 'percent', advanced: true },
    ],
    dimensions: ['period', 'broadcast', 'status'],
    filters: ['status', 'broadcast'],
  },
  team: {
    key: 'team',
    defaultMetrics: ['replies', 'median_response_minutes'],
    defaultDimensions: ['agent'],
    metrics: [
      { key: 'replies', unit: count },
      { key: 'conversations', unit: count },
      { key: 'avg_response_minutes', unit: 'minutes' },
      { key: 'median_response_minutes', unit: 'minutes' },
      { key: 'p90_response_minutes', unit: 'minutes', advanced: true },
      { key: 'within_target', unit: count, advanced: true },
      { key: 'within_target_rate', unit: 'percent', advanced: true },
    ],
    dimensions: ['period', 'agent', 'channel'],
    filters: ['channel', 'agent'],
  },
};

export function isReportDataset(value: unknown): value is ReportDataset {
  return typeof value === 'string' && (REPORT_DATASETS as readonly string[]).includes(value);
}

export function isGrain(value: unknown): value is Grain {
  return typeof value === 'string' && (GRAINS as readonly string[]).includes(value);
}

export function metricUnit(dataset: ReportDataset, metric: string): MetricUnit {
  return DATASETS[dataset].metrics.find((m) => m.key === metric)?.unit ?? count;
}

export function metricKeys(dataset: ReportDataset): string[] {
  return DATASETS[dataset].metrics.map((m) => m.key);
}

export function dimensionKeys(dataset: ReportDataset): DimensionKey[] {
  return DATASETS[dataset].dimensions;
}

export function filterKeys(dataset: ReportDataset): FilterKey[] {
  return DATASETS[dataset].filters;
}

/** `YYYY-MM-DD` validation that does not depend on the host timezone. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d + days));
  return probe.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Grain the UI offers for a period. A 90-day report bucketed by day is 90
 * rows of noise on a phone; the runner accepts any grain, this only picks
 * the one that reads well by default.
 */
export function suggestGrain(days: number): Grain {
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Today in a specific timezone as `YYYY-MM-DD` (en-CA formats exactly so). */
export function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export interface NormalizeOptions {
  /** Today in the caller's timezone, `YYYY-MM-DD`. */
  today: string;
  timeZone: string;
  /** When false, `advanced` metrics are rejected (plan gate). */
  allowAdvanced?: boolean;
}

/**
 * Turn whatever the client sent into a config the runner is guaranteed to
 * accept — or throw. Never "fix" a request silently: a report that quietly
 * answers a different question is worse than an error.
 */
export function normalizeReportConfig(
  input: unknown,
  { today, timeZone, allowAdvanced = true }: NormalizeOptions,
): ReportConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ReportConfigError('invalid_config', 'report config must be an object');
  }
  const raw = input as Record<string, unknown>;

  if (!isReportDataset(raw.dataset)) {
    throw new ReportConfigError('unknown_dataset', String(raw.dataset ?? ''));
  }
  const dataset = raw.dataset;
  const def = DATASETS[dataset];

  const to = isIsoDate(raw.to) ? raw.to : today;
  const from = isIsoDate(raw.from) ? raw.from : addDays(to, -29);

  if (daysBetween(from, to) < 1) {
    throw new ReportConfigError('period_reversed', `${from} → ${to}`);
  }
  if (daysBetween(from, to) > MAX_REPORT_DAYS) {
    throw new ReportConfigError('period_too_long', `${from} → ${to}`);
  }

  const grain: Grain = isGrain(raw.grain) ? raw.grain : suggestGrain(daysBetween(from, to));

  const dimsRaw = Array.isArray(raw.dimensions) ? raw.dimensions : null;
  // Two breakdowns is the readable maximum — a third turns the table into a
  // spreadsheet nobody scans, and the SQL ordering assumes the first
  // dimension is the label column.
  const dimensions: DimensionKey[] = dimsRaw
    ? dedupe(
        dimsRaw
          .filter((d): d is DimensionKey => typeof d === 'string')
          .filter((d) => def.dimensions.includes(d as DimensionKey)),
      ).slice(0, 2)
    : [...def.defaultDimensions];

  for (const requested of dimsRaw ?? []) {
    if (typeof requested === 'string' && !def.dimensions.includes(requested as DimensionKey)) {
      throw new ReportConfigError('unknown_dimension', `${requested} @ ${dataset}`);
    }
  }

  const metricsRaw = Array.isArray(raw.metrics) ? raw.metrics : null;
  const metrics: string[] = metricsRaw
    ? dedupe(metricsRaw.filter((m): m is string => typeof m === 'string'))
    : [...def.defaultMetrics];

  if (metrics.length === 0) {
    throw new ReportConfigError('no_metrics', dataset);
  }
  for (const metric of metrics) {
    const found = def.metrics.find((m) => m.key === metric);
    if (!found) {
      throw new ReportConfigError('unknown_metric', `${metric} @ ${dataset}`);
    }
    if (found.advanced && !allowAdvanced) {
      throw new ReportConfigError('metric_not_in_plan', metric);
    }
  }

  const filters = normalizeFilters(raw.filters, def.filters);

  const limitRaw = Number(raw.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_REPORT_ROWS)
    : DEFAULT_REPORT_ROWS;

  const tz = typeof raw.tz === 'string' && raw.tz.trim() ? raw.tz.trim() : timeZone;

  return { dataset, metrics, dimensions, grain, from, to, tz, filters, limit };
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeFilters(input: unknown, allowed: FilterKey[]): ReportFilters {
  const out: ReportFilters = {};
  if (input == null) return out;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ReportConfigError('invalid_filters');
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(allowed as string[]).includes(key)) {
      throw new ReportConfigError('unknown_filter', key);
    }
    if (value == null) continue;
    if (!Array.isArray(value)) throw new ReportConfigError('invalid_filter_value', key);
    const values = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (values.length > 0) out[key as FilterKey] = dedupe(values).slice(0, 200);
  }
  return out;
}

// ------------------------------------------------------------
// Built-in reports
//
// These are the questions a clinic actually asks every week. Each is just a
// pre-filled config: opening one in the builder is the same code path as
// editing it, so "customise this report" never needs a second implementation.
// ------------------------------------------------------------
export interface ReportPreset {
  id: string;
  dataset: ReportDataset;
  metrics: string[];
  dimensions: DimensionKey[];
  grain?: Grain;
  /** Relative window in days; the builder converts it to dates. */
  days: number;
  /** Requires `reports_advanced`. */
  advanced?: boolean;
  /** Requires `exports` (the preset exists to be downloaded). */
  needsExport?: boolean;
}

export const PRESETS: ReportPreset[] = [
  {
    id: 'volume',
    dataset: 'messages',
    metrics: ['messages', 'inbound', 'outbound', 'failed'],
    dimensions: ['period'],
    grain: 'day',
    days: 30,
  },
  {
    id: 'team-performance',
    dataset: 'team',
    metrics: ['replies', 'median_response_minutes', 'p90_response_minutes', 'within_target_rate'],
    dimensions: ['agent'],
    days: 30,
    advanced: true,
  },
  {
    id: 'response-times',
    dataset: 'team',
    metrics: ['replies', 'avg_response_minutes'],
    dimensions: ['period'],
    grain: 'week',
    days: 90,
    advanced: true,
  },
  {
    id: 'new-contacts',
    dataset: 'contacts',
    metrics: ['contacts'],
    dimensions: ['period', 'channel'],
    grain: 'week',
    days: 90,
  },
  {
    id: 'tags',
    dataset: 'conversations',
    metrics: ['conversations', 'closed', 'first_response_avg'],
    dimensions: ['tag'],
    days: 90,
    advanced: true,
  },
  {
    id: 'pipeline',
    dataset: 'deals',
    metrics: ['deals', 'won', 'lost', 'won_value'],
    dimensions: ['stage'],
    days: 90,
  },
  {
    id: 'broadcasts',
    dataset: 'broadcasts',
    metrics: ['broadcasts', 'recipients', 'delivered', 'read', 'replied'],
    dimensions: ['broadcast'],
    days: 180,
  },
  {
    id: 'failed-messages',
    dataset: 'messages',
    metrics: ['failed'],
    dimensions: ['period', 'agent'],
    grain: 'day',
    days: 30,
  },
];

export function presetConfig(
  preset: ReportPreset,
  { today, timeZone, days }: { today: string; timeZone: string; days?: number },
): ReportConfig {
  // `days` lets the caller pick a 7/30/90 window without becoming a builder:
  // the metrics, dimensions and grain still come from the catalogue.
  const window = days && days > 0 ? days : preset.days;
  return {
    dataset: preset.dataset,
    metrics: preset.metrics,
    dimensions: preset.dimensions,
    grain: preset.grain ?? suggestGrain(window),
    from: addDays(today, -(window - 1)),
    to: today,
    tz: timeZone,
    filters: {},
    limit: DEFAULT_REPORT_ROWS,
  };
}
