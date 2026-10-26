/**
 * Formatting helpers for the admin panel.
 *
 * Two rules that matter here:
 *  - Numbers always render with Latin digits, whatever the UI locale is.
 *    An operator scanning a table of amounts and counts should not have to
 *    read Arabic-Indic numerals.
 *  - Timestamps are formatted with an explicit timeZone so the server HTML
 *    and the client hydration agree. Browser-locale formatting is a
 *    hydration-mismatch generator.
 */

export const ADMIN_TIME_ZONE = 'Africa/Cairo';

export function formatMoney(
  value: number | string | null | undefined,
  currency = 'USD'
): string {
  const amount = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!Number.isFinite(amount)) return `0.00 ${currency}`;
  const fixed = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${fixed} ${currency}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return value.toLocaleString('en-US');
}

/** `2026-10-26`, or `—` when the value is missing. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ADMIN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** `2026-10-26 14:08` (Cairo), or `—`. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ADMIN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** Whole days from now until `iso`; negative when in the past. */
export function daysFromNow(
  iso: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const MS_DAY = 86_400_000;
  return Math.ceil((date.getTime() - now.getTime()) / MS_DAY);
}

/** `in 3 days` / `today` / `4 days ago` — plain, no library. */
export function humanDays(
  iso: string | null | undefined,
  now: Date = new Date()
): string {
  const days = daysFromNow(iso, now);
  if (days === null) return '—';
  if (days === 0) return 'today';
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d ago`;
}

/** `2026-10` — the month key used by signup counts. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
