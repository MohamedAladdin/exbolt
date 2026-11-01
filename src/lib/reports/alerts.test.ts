import { describe, expect, it } from 'vitest';

import { AlertError, alertSummary, breaches, normalizeAlert } from './alerts';

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (err) {
    return err instanceof AlertError ? err.code : 'unexpected';
  }
}

const METRICS = ['messages', 'failed', 'delivery_rate'];

describe('normalizeAlert', () => {
  it('accepts a rule on a metric the report produces', () => {
    expect(
      normalizeAlert({ metric: 'failed', comparator: 'gt', threshold: 50 }, METRICS),
    ).toEqual({ metric: 'failed', comparator: 'gt', threshold: 50, cooldownHours: 24, isActive: true });
  });

  it('refuses a metric the report does not produce', () => {
    expect(codeOf(() => normalizeAlert({ metric: 'p90_response_minutes', comparator: 'gt', threshold: 1 }, METRICS))).toBe(
      'metric_not_in_report',
    );
  });

  it('refuses a bad comparator and a non-numeric threshold', () => {
    expect(codeOf(() => normalizeAlert({ metric: 'failed', comparator: 'above', threshold: 1 }, METRICS))).toBe('invalid_comparator');
    expect(codeOf(() => normalizeAlert({ metric: 'failed', comparator: 'gt', threshold: 'abc' }, METRICS))).toBe('invalid_threshold');
  });

  it('falls back to a 24h cooldown when the value is out of range', () => {
    expect(
      normalizeAlert({ metric: 'failed', comparator: 'gt', threshold: 1, cooldownHours: 999 }, METRICS).cooldownHours,
    ).toBe(24);
  });
});

describe('breaches', () => {
  it('compares in both directions', () => {
    expect(breaches(51, { comparator: 'gt', threshold: 50 })).toBe(true);
    expect(breaches(50, { comparator: 'gt', threshold: 50 })).toBe(false);
    expect(breaches(50, { comparator: 'gte', threshold: 50 })).toBe(true);
    expect(breaches(89.9, { comparator: 'lt', threshold: 90 })).toBe(true);
    expect(breaches(90, { comparator: 'lte', threshold: 90 })).toBe(true);
  });

  it('never fires on missing data', () => {
    // A report with no rows must not page anyone; "no data" is not "zero".
    expect(breaches(null, { comparator: 'lt', threshold: 90 })).toBe(false);
    expect(breaches(undefined, { comparator: 'gt', threshold: 0 })).toBe(false);
    expect(breaches('', { comparator: 'gt', threshold: 0 })).toBe(false);
  });

  it('accepts the string numbers the JSONB totals carry', () => {
    expect(breaches('12', { comparator: 'gt', threshold: 10 })).toBe(true);
  });
});

describe('alertSummary', () => {
  it('reads as a sentence with units', () => {
    const text = alertSummary({ metric: 'delivery_rate', comparator: 'lt', threshold: 90 }, 87.5, (value) => `${value}%`);
    expect(text).toBe('87.5% < 90%');
  });
});
