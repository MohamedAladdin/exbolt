import { describe, expect, it } from 'vitest';

import { ScheduleError, nextRunAt, normalizeRecipients, normalizeSchedule } from './schedule';

const TZ = 'Africa/Cairo';

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (err) {
    return err instanceof ScheduleError ? err.code : 'unexpected';
  }
}

describe('normalizeRecipients', () => {
  it('splits, trims, lowercases and de-duplicates', () => {
    expect(normalizeRecipients('A@x.com, a@X.com; b@y.co')).toEqual(['a@x.com', 'b@y.co']);
  });

  it('refuses an invalid address instead of dropping it', () => {
    expect(codeOf(() => normalizeRecipients('nope'))).toBe('invalid_recipient');
    expect(codeOf(() => normalizeRecipients(''))).toBe('no_recipients');
  });

  it('caps the list', () => {
    const many = Array.from({ length: 12 }, (_, i) => `u${i}@x.com`).join(',');
    expect(codeOf(() => normalizeRecipients(many))).toBe('too_many_recipients');
  });
});

describe('normalizeSchedule', () => {
  it('keeps a weekly schedule weekly', () => {
    const schedule = normalizeSchedule(
      { cadence: 'weekly', weekday: 1, hour: 8, recipients: 'a@x.com' },
      TZ,
    );
    expect(schedule).toMatchObject({ cadence: 'weekly', weekday: 1, dayOfMonth: null, hour: 8 });
    expect(schedule.timeZone).toBe(TZ);
  });

  it('refuses the fields that belong to the other cadence', () => {
    // A weekly schedule with day_of_month would never fire; the table rejects
    // it, and so does this so the user sees why.
    expect(
      codeOf(() => normalizeSchedule({ cadence: 'weekly', hour: 8, recipients: 'a@x.com' }, TZ)),
    ).toBe('invalid_weekday');
    expect(
      codeOf(() =>
        normalizeSchedule({ cadence: 'monthly', dayOfMonth: 31, hour: 8, recipients: 'a@x.com' }, TZ),
      ),
    ).toBe('invalid_day_of_month');
  });

  it('rejects a bad hour and a bad timezone', () => {
    expect(codeOf(() => normalizeSchedule({ cadence: 'weekly', weekday: 1, hour: 24, recipients: 'a@x.com' }, TZ))).toBe('invalid_hour');
    expect(
      codeOf(() =>
        normalizeSchedule({ cadence: 'weekly', weekday: 1, hour: 8, timeZone: 'Mars/Base', recipients: 'a@x.com' }, TZ),
      ),
    ).toBe('invalid_time_zone');
  });
});

describe('nextRunAt', () => {
  const base = { hour: 8, timeZone: TZ, recipients: ['a@x.com'], format: 'csv' as const, isActive: true };

  it('returns the next matching weekday at the chosen hour', () => {
    // 2026-11-01 is a Sunday; the next Monday 08:00 in Cairo is 2026-11-02.
    const from = new Date('2026-11-01T06:00:00Z');
    const next = nextRunAt({ ...base, cadence: 'weekly', weekday: 1, dayOfMonth: null }, from);
    expect(next?.toISOString().slice(0, 10)).toBe('2026-11-02');
  });

  it('skips today when the hour has already passed', () => {
    const from = new Date('2026-11-02T09:00:00Z'); // 11:00 in Cairo
    const next = nextRunAt({ ...base, cadence: 'weekly', weekday: 1, dayOfMonth: null }, from);
    expect(next?.toISOString().slice(0, 10)).toBe('2026-11-09');
  });

  it('returns nothing for a paused schedule', () => {
    expect(
      nextRunAt({ ...base, cadence: 'weekly', weekday: 1, dayOfMonth: null, isActive: false }),
    ).toBeNull();
  });

  it('finds the monthly day', () => {
    const next = nextRunAt(
      { ...base, cadence: 'monthly', weekday: null, dayOfMonth: 15 },
      new Date('2026-11-01T06:00:00Z'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-11-15');
  });
});
