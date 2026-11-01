import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DATASETS,
  MAX_REPORT_DAYS,
  PRESETS,
  ReportConfigError,
  REPORT_DATASETS,
  addDays,
  daysBetween,
  isIsoDate,
  normalizeReportConfig,
  presetConfig,
  suggestGrain,
  todayIn,
} from './catalog';

const TODAY = '2026-11-01';

/** The slug the API maps to a 400 — the message is human-facing detail. */
function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (err) {
    return err instanceof ReportConfigError ? err.code : 'unexpected_error';
  }
}

describe('isIsoDate', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('normalizeReportConfig', () => {
  it('defaults to the last 30 days and the dataset defaults', () => {
    const config = normalizeReportConfig({ dataset: 'messages' }, { today: TODAY, timeZone: 'Africa/Cairo' });
    expect(config.from).toBe(addDays(TODAY, -29));
    expect(config.to).toBe(TODAY);
    expect(config.metrics).toEqual(DATASETS.messages.defaultMetrics);
    expect(config.dimensions).toEqual(DATASETS.messages.defaultDimensions);
    expect(config.tz).toBe('Africa/Cairo');
  });

  it('rejects an unknown dataset, metric, dimension and filter', () => {
    const base = { dataset: 'messages' };
    expect(codeOf(() => normalizeReportConfig({ dataset: 'users' }, { today: TODAY, timeZone: 'UTC' }))).toBe('unknown_dataset');
    expect(codeOf(() => normalizeReportConfig({ ...base, metrics: ['nope'] }, { today: TODAY, timeZone: 'UTC' }))).toBe('unknown_metric');
    expect(codeOf(() => normalizeReportConfig({ ...base, dimensions: ['pipeline'] }, { today: TODAY, timeZone: 'UTC' }))).toBe('unknown_dimension');
    expect(codeOf(() => normalizeReportConfig({ ...base, filters: { pipeline: ['x'] } }, { today: TODAY, timeZone: 'UTC' }))).toBe('unknown_filter');
  });

  it('refuses advanced metrics on a plan without them', () => {
    expect(
      codeOf(() =>
        normalizeReportConfig(
          { dataset: 'team', metrics: ['p90_response_minutes'] },
          { today: TODAY, timeZone: 'UTC', allowAdvanced: false },
        ),
      ),
    ).toBe('metric_not_in_plan');
  });

  it('rejects a reversed or over-long period instead of clamping it', () => {
    expect(
      codeOf(() =>
        normalizeReportConfig({ dataset: 'messages', from: '2026-05-01', to: '2026-04-01' }, { today: TODAY, timeZone: 'UTC' }),
      ),
    ).toBe('period_reversed');
    expect(
      codeOf(() =>
        normalizeReportConfig(
          { dataset: 'messages', from: addDays(TODAY, -(MAX_REPORT_DAYS + 5)), to: TODAY },
          { today: TODAY, timeZone: 'UTC' },
        ),
      ),
    ).toBe('period_too_long');
  });

  it('caps two dimensions — the table stops being readable after that', () => {
    const config = normalizeReportConfig(
      { dataset: 'messages', dimensions: ['period', 'agent', 'status'] },
      { today: TODAY, timeZone: 'UTC' },
    );
    expect(config.dimensions).toEqual(['period', 'agent']);
  });

  it('turns comparison on only when it is literally requested', () => {
    const base = { dataset: 'messages' as const };
    expect(normalizeReportConfig({ ...base, compare: true }, { today: TODAY, timeZone: 'UTC' }).compare).toBe(true);
    // "true" as a string, 1, or anything truthy is not a comparison request.
    expect(normalizeReportConfig({ ...base, compare: 'true' }, { today: TODAY, timeZone: 'UTC' }).compare).toBe(false);
    expect(normalizeReportConfig(base, { today: TODAY, timeZone: 'UTC' }).compare).toBe(false);
  });

  it('drops empty filter arrays instead of sending them to the runner', () => {
    const config = normalizeReportConfig(
      { dataset: 'messages', filters: { channel: [], status: ['failed'] } },
      { today: TODAY, timeZone: 'UTC' },
    );
    expect(config.filters).toEqual({ status: ['failed'] });
  });

  it('keeps a caller-supplied timezone but survives a missing one', () => {
    expect(
      normalizeReportConfig({ dataset: 'messages', tz: 'Europe/Berlin' }, { today: TODAY, timeZone: 'UTC' }).tz,
    ).toBe('Europe/Berlin');
    expect(normalizeReportConfig({ dataset: 'messages' }, { today: TODAY, timeZone: 'UTC' }).tz).toBe('UTC');
  });
});

describe('helpers', () => {
  it('counts days inclusively', () => {
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(1);
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(31);
  });

  it('suggests a readable grain for the window', () => {
    expect(suggestGrain(7)).toBe('day');
    expect(suggestGrain(90)).toBe('week');
    expect(suggestGrain(366)).toBe('month');
  });

  it('formats today in a timezone', () => {
    expect(todayIn('Africa/Cairo')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('presets', () => {
  it('builds a config the runner accepts', () => {
    for (const preset of PRESETS) {
      const config = presetConfig(preset, { today: TODAY, timeZone: 'Africa/Cairo' });
      expect(() =>
        normalizeReportConfig(config, { today: TODAY, timeZone: 'Africa/Cairo', allowAdvanced: true }),
      ).not.toThrow();
      expect(daysBetween(config.from, config.to)).toBe(preset.days);
      expect(config.metrics.length).toBeGreaterThan(0);
    }
  });

  it('only uses metrics and dimensions their dataset actually has', () => {
    for (const preset of PRESETS) {
      const def = DATASETS[preset.dataset];
      for (const metric of preset.metrics) {
        expect(def.metrics.map((m) => m.key), `${preset.id}/${metric}`).toContain(metric);
      }
      for (const dimension of preset.dimensions) {
        expect(def.dimensions, `${preset.id}/${dimension}`).toContain(dimension);
      }
    }
  });
});

// ------------------------------------------------------------
// Drift guard: the catalogue and the SQL runner must agree.
//
// `run_report` raises on a metric it does not know, and the catalogue is
// what the UI renders from — so a metric added on one side only is a report
// button that always fails with a 400, only in production. This test reads
// the migration and asserts each dataset's metric list appears inside that
// dataset's branch, which is where the two lists actually have to match.
// ------------------------------------------------------------
describe('catalogue ↔ run_report', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '082_reports.sql'),
    'utf8',
  );

  const markers: Record<string, string> = {
    messages: "WHEN 'messages' THEN CASE v_metric",
    conversations: "WHEN 'conversations' THEN CASE v_metric",
    contacts: "WHEN 'contacts' THEN CASE v_metric",
    deals: "WHEN 'deals' THEN CASE v_metric",
    broadcasts: "WHEN 'broadcasts' THEN CASE v_metric",
    team: 'ELSE CASE v_metric',
  };

  function branchOf(dataset: string): string {
    const start = sql.indexOf(markers[dataset]);
    expect(start, `metric branch for ${dataset}`).toBeGreaterThan(-1);
    const others = Object.values(markers)
      .map((marker) => sql.indexOf(marker))
      .filter((index) => index > start);
    const end = others.length > 0 ? Math.min(...others) : sql.length;
    return sql.slice(start, end);
  }

  it.each(REPORT_DATASETS)('implements every %s metric', (dataset) => {
    const branch = branchOf(dataset);
    for (const metric of DATASETS[dataset].metrics) {
      expect(branch, `${dataset}/${metric.key}`).toContain(`WHEN '${metric.key}'`);
    }
  });

  it.each(REPORT_DATASETS)('accepts every %s filter', (dataset) => {
    for (const filter of DATASETS[dataset].filters) {
      expect(sql).toContain(`v_key = '${filter}'`);
    }
  });

  it('returns a previous-period block only when asked', () => {
    expect(sql).toContain("'previous'");
    expect(sql).toContain('v_prev_start');
  });

  it('sends the nameless-member sentinel the UI translates', () => {
    // The label is chosen per dataset in the UI, so the SQL must not bake a
    // dash into the value: '__none' is the contract.
    expect(sql).toContain("'__none'");
    expect(sql).not.toContain("COALESCE(ap.full_name, ''—'')");
  });

  it('implements every dimension the catalogue offers', () => {
    for (const dataset of REPORT_DATASETS) {
      for (const dimension of DATASETS[dataset].dimensions) {
        expect(sql, `${dataset}/${dimension}`).toContain(`WHEN '${dimension}'`);
      }
    }
  });
});
