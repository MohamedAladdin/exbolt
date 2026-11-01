// ============================================================
// Reports — alert rules (validation + evaluation).
//
// A rule is "this metric of this saved report crossed this number". Nothing
// more: the metric list comes from the report's own config, so an alert can
// never measure something the report does not show.
//
// Two properties matter more than the comparison itself:
//   * direction — "failed messages above 50" is bad, "delivered above 50" is
//     not news; the UI colours by `lowerIsBetter` rather than by the operator.
//   * cooldown — a metric parked above its threshold must notify once, not on
//     every tick. The cooldown lives on the rule, not in the cron.
// ============================================================

export const COMPARATORS = ['gt', 'gte', 'lt', 'lte'] as const;
export type Comparator = (typeof COMPARATORS)[number];

export interface AlertRuleInput {
  metric: string;
  comparator: Comparator;
  threshold: number;
  cooldownHours: number;
  isActive: boolean;
}

export class AlertError extends Error {
  readonly status = 400 as const;
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'AlertError';
    this.code = code;
  }
}

export function normalizeAlert(input: unknown, allowedMetrics: string[]): AlertRuleInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AlertError('invalid_alert');
  }
  const raw = input as Record<string, unknown>;

  const metric = typeof raw.metric === 'string' ? raw.metric : '';
  if (!allowedMetrics.includes(metric)) {
    // The report's own metric list is the limit: an alert on a metric the
    // report does not produce would read `—` forever.
    throw new AlertError('metric_not_in_report', metric);
  }

  const comparator = raw.comparator;
  if (comparator !== 'gt' && comparator !== 'gte' && comparator !== 'lt' && comparator !== 'lte') {
    throw new AlertError('invalid_comparator', String(comparator ?? ''));
  }

  const threshold = Number(raw.threshold);
  if (!Number.isFinite(threshold)) throw new AlertError('invalid_threshold');

  const cooldownRaw = Number(raw.cooldownHours ?? 24);
  const cooldownHours = Number.isInteger(cooldownRaw) && cooldownRaw >= 1 && cooldownRaw <= 168 ? cooldownRaw : 24;

  return { metric, comparator, threshold, cooldownHours, isActive: raw.isActive !== false };
}

/** Does `value` breach the rule? `null` (no data) never does. */
export function breaches(
  value: number | string | null | undefined,
  rule: Pick<AlertRuleInput, 'comparator' | 'threshold'>,
): boolean {
  if (value == null || value === '') return false;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return false;
  switch (rule.comparator) {
    case 'gt':
      return numeric > rule.threshold;
    case 'gte':
      return numeric >= rule.threshold;
    case 'lt':
      return numeric < rule.threshold;
    case 'lte':
      return numeric <= rule.threshold;
  }
}

/** Same builder the API uses for the notification body. */
export function alertSummary(
  rule: Pick<AlertRuleInput, 'metric' | 'comparator' | 'threshold'>,
  value: number | null,
  format: (value: number, metric: string) => string,
): string {
  const sign: Record<Comparator, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
  return `${format(value ?? 0, rule.metric)} ${sign[rule.comparator]} ${format(rule.threshold, rule.metric)}`;
}
