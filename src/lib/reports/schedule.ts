// ============================================================
// Reports — schedules (validation + when the next one runs).
//
// The product only offers two cadences on purpose: "كل يوم اثنين ٨ الصبح" and
// "أول كل شهر". Anything else is a cron expression, and a manager who wanted a
// cron expression would have asked for exports, not a report.
//
// Storage rules that are easy to get wrong and are enforced here as well as in
// the table: a weekly schedule carries `weekday` and no `day_of_month`, a
// monthly one the reverse, and the day of month stops at 28 so February is
// never skipped.
// ============================================================

export const CADENCES = ['weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const SCHEDULE_FORMATS = ['csv', 'html'] as const;
export type ScheduleFormat = (typeof SCHEDULE_FORMATS)[number];

export interface ReportScheduleInput {
  cadence: Cadence;
  weekday?: number | null;
  dayOfMonth?: number | null;
  hour: number;
  timeZone: string;
  recipients: string[];
  format: ScheduleFormat;
  isActive: boolean;
}

export interface ReportSchedule extends ReportScheduleInput {
  id: string;
  savedReportId: string;
  lastSentAt: string | null;
  lastError: string | null;
}

export class ScheduleError extends Error {
  readonly status = 400 as const;
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'ScheduleError';
    this.code = code;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_RECIPIENTS = 10;

export function normalizeRecipients(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;\s]+/) : [];
  const out: string[] = [];
  for (const value of list) {
    if (typeof value !== 'string') continue;
    const email = value.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL.test(email)) throw new ScheduleError('invalid_recipient', email);
    if (!out.includes(email)) out.push(email);
  }
  if (out.length === 0) throw new ScheduleError('no_recipients');
  if (out.length > MAX_RECIPIENTS) throw new ScheduleError('too_many_recipients', String(out.length));
  return out;
}

export function normalizeSchedule(input: unknown, fallbackTimeZone = 'Africa/Cairo'): ReportScheduleInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ScheduleError('invalid_schedule');
  }
  const raw = input as Record<string, unknown>;

  const cadence = raw.cadence;
  if (cadence !== 'weekly' && cadence !== 'monthly') {
    throw new ScheduleError('invalid_cadence', String(cadence ?? ''));
  }

  const hour = Number(raw.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new ScheduleError('invalid_hour', String(raw.hour ?? ''));
  }

  let weekday: number | null = null;
  let dayOfMonth: number | null = null;

  if (cadence === 'weekly') {
    const value = Number(raw.weekday);
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      throw new ScheduleError('invalid_weekday', String(raw.weekday ?? ''));
    }
    weekday = value;
  } else {
    const value = Number(raw.dayOfMonth);
    if (!Number.isInteger(value) || value < 1 || value > 28) {
      throw new ScheduleError('invalid_day_of_month', String(raw.dayOfMonth ?? ''));
    }
    dayOfMonth = value;
  }

  const format: ScheduleFormat = raw.format === 'html' ? 'html' : 'csv';

  const timeZone =
    typeof raw.timeZone === 'string' && raw.timeZone.trim() ? raw.timeZone.trim() : fallbackTimeZone;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    throw new ScheduleError('invalid_time_zone', timeZone);
  }

  return {
    cadence,
    weekday,
    dayOfMonth,
    hour,
    timeZone,
    recipients: normalizeRecipients(raw.recipients),
    format,
    isActive: raw.isActive !== false,
  };
}

/**
 * The next delivery instant, computed without a date library: walk forward a
 * day at a time in the schedule's timezone until the cadence matches and the
 * hour has not passed. `null` when the schedule is paused.
 */
export function nextRunAt(schedule: ReportScheduleInput, from: Date = new Date()): Date | null {
  if (!schedule.isActive) return null;

  const local = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: schedule.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(date);

  const parts = (date: Date) => {
    const map: Record<string, string> = {};
    for (const part of local(date)) map[part.type] = part.value;
    return map;
  };

  for (let offset = 0; offset <= 40; offset += 1) {
    const probe = new Date(from.getTime() + offset * 86_400_000);
    const p = parts(probe);
    const hourNow = Number(p.hour) % 24;
    const weekdayNow = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`).getUTCDay();
    const dayNow = Number(p.day);

    const matches =
      schedule.cadence === 'weekly'
        ? weekdayNow === schedule.weekday
        : dayNow === schedule.dayOfMonth;

    if (!matches) continue;
    if (offset === 0 && hourNow > schedule.hour) continue;

    // Timezone-accurate instant for "that day at that hour" in the schedule's
    // own zone: build the UTC guess, then correct by the offset the zone had
    // at that moment.
    const guess = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), schedule.hour));
    const localAtGuess = parts(guess);
    const drift = (Number(localAtGuess.hour) % 24) - schedule.hour;
    return new Date(guess.getTime() - drift * 3_600_000);
  }
  return null;
}

export function describeSchedule(schedule: ReportScheduleInput): string {
  const time = `${String(schedule.hour).padStart(2, '0')}:00`;
  return schedule.cadence === 'weekly'
    ? `weekly:${schedule.weekday}@${time}`
    : `monthly:${schedule.dayOfMonth}@${time}`;
}
