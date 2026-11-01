import { describe, expect, it } from 'vitest';

import { UNASSIGNED_AGENT, agentPlaceholderKey } from './catalog';
import { formatCell, formatDuration, formatMetric } from './run';

const context = {
  locale: 'ar-EG',
  currency: 'EGP',
  dataset: 'team' as const,
  grain: 'day' as const,
  timeZone: 'Africa/Cairo',
  agentPlaceholder: 'بدون موظف مسجّل',
};

describe('agent placeholder', () => {
  it('gives each dataset the label its NULL actually means', () => {
    expect(agentPlaceholderKey('messages')).toBe('customer');
    expect(agentPlaceholderKey('conversations')).toBe('unassigned');
    expect(agentPlaceholderKey('deals')).toBe('unassigned');
    expect(agentPlaceholderKey('team')).toBe('noSender');
  });

  it('prints the translated word instead of the sentinel or a dash', () => {
    const column = { key: 'agent', kind: 'text' as const };
    expect(formatCell(UNASSIGNED_AGENT, column, context)).toBe('بدون موظف مسجّل');
    // Without a label it degrades to the dash rather than leaking "__none".
    expect(formatCell(UNASSIGNED_AGENT, column, { ...context, agentPlaceholder: undefined })).toBe('—');
  });

  it('leaves a real name and the other columns alone', () => {
    expect(formatCell('Mira', { key: 'agent', kind: 'text' }, context)).toBe('Mira');
    expect(formatCell('open', { key: 'status', kind: 'text' }, context)).toBe('open');
  });
});

describe('formatMetric', () => {
  it('keeps the unit the metric was measured in', () => {
    expect(formatMetric(31.8, 'percent', { locale: 'en-US' })).toBe('31.8%');
    expect(formatMetric(10619, 'count', { locale: 'en-US' })).toBe('10,619');
    expect(formatMetric(null, 'count', { locale: 'en-US' })).toBe('—');
  });

  it('renders minutes as a duration a manager can repeat', () => {
    expect(formatDuration(0.4, 'en-US')).toBe('< 1 min');
    expect(formatDuration(25.8, 'en-US')).toBe('25.8 min');
    expect(formatDuration(180, 'en-US')).toBe('3 h');
    expect(formatDuration(1626, 'en-US')).toBe('1 d 3 h');
  });
});
