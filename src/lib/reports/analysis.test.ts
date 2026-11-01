import { describe, expect, it } from 'vitest';

import { buildAnalysisPrompt } from './analysis';
import type { ReportConfig } from './catalog';
import type { ReportResult } from './run';

const config: ReportConfig = {
  dataset: 'messages',
  metrics: ['messages', 'failed', 'delivery_rate'],
  dimensions: ['period'],
  grain: 'day',
  from: '2026-10-01',
  to: '2026-10-03',
  tz: 'Africa/Cairo',
  filters: {},
  limit: 1000,
};

function result(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    dataset: 'messages',
    from: '2026-10-01',
    to: '2026-10-03',
    timeZone: 'Africa/Cairo',
    grain: 'day',
    columns: [
      { key: 'period', kind: 'time' },
      { key: 'messages', kind: 'number' },
      { key: 'failed', kind: 'number' },
      { key: 'delivery_rate', kind: 'number' },
    ],
    rows: [
      { period: '2026-10-01T00:00:00+00:00', messages: 120, failed: 3, delivery_rate: 97.5 },
      { period: '2026-10-02T00:00:00+00:00', messages: 80, failed: 9, delivery_rate: 88.1 },
    ],
    totals: { messages: 200, failed: 12, delivery_rate: 93.4 },
    rowCount: 2,
    truncated: false,
    limit: 1000,
    ...overrides,
  };
}

describe('buildAnalysisPrompt', () => {
  it('sends the totals and the rows the model must reason from', () => {
    const { user } = buildAnalysisPrompt(config, result(), { title: 'حجم الرسائل', locale: 'ar' });
    expect(user).toContain('الإجمالي: messages=200, failed=12, delivery_rate=93.4%');
    expect(user).toContain('messages=120');
    expect(user).toContain('2026-10-01 → 2026-10-03');
  });

  it('includes the previous period only when the report compared', () => {
    const plain = buildAnalysisPrompt(config, result(), { title: 't', locale: 'ar' }).user;
    expect(plain).not.toContain('الفترة السابقة');

    const compared = buildAnalysisPrompt(
      config,
      result({ previous: { from: '2026-09-28', to: '2026-09-30', totals: { messages: 100, failed: 2 } } }),
      { title: 't', locale: 'ar' },
    ).user;
    expect(compared).toContain('الفترة السابقة: messages=100, failed=2');
  });

  it('caps the rows it sends — this is a prompt, not an export', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      period: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T00:00:00+00:00`,
      messages: index,
      failed: 0,
      delivery_rate: 99,
    }));
    const { user } = buildAnalysisPrompt(config, result({ rows: many }), { title: 't', locale: 'ar' });
    expect(user.split('\n').filter((line) => line.includes('messages=')).length).toBeLessThanOrEqual(27);
  });

  it('tells the model not to invent numbers, in both languages', () => {
    expect(buildAnalysisPrompt(config, result(), { title: 't', locale: 'ar' }).system).toContain(
      'ممنوع تمامًا اختراع رقم',
    );
    expect(buildAnalysisPrompt(config, result(), { title: 't', locale: 'en' }).system).toContain(
      'Never invent a figure',
    );
  });
});
