// ============================================================
// Reports — what the account's plan allows.
//
// The packaging decision this encodes (2026-11-01):
//
//   Core ($65)    ready-made reports, 7/30/90-day windows, CSV export,
//                 last 90 days of history, no saved reports.
//   Growth ($129) + the builder (any metrics / two dimensions / filters /
//                 any window), saved + shared reports, advanced metrics,
//                 12 months of history.
//   Scale ($229)  + unlimited history and unlimited saved reports (plus the
//                 API/branch features the plan already owned).
//
// Why the line is BOTH "customization" and "history depth": a preset report is
// a number you can screenshot, so customization alone does not create the felt
// need to upgrade. History does — the first time a manager wants "the same
// report for last year", the account is either on Growth or it is not.
//
// Everything here is presentation-adjacent but enforced server-side: the UI
// hides what a plan lacks, the routes refuse it (`ReportPlanError` → 402), and
// the window is checked against the same access object the page renders from.
// ============================================================

import type { Entitlements } from '@/lib/plans/entitlements';
import { addDays, daysBetween, type ReportConfig } from './catalog';

export interface ReportAccess {
  /** The builder, saved reports and advanced metrics. */
  custom: boolean;
  /** `null` = unlimited. Otherwise the oldest day the account may report on. */
  historyDays: number | null;
  /** `null` = unlimited. `0` = saving is not part of the plan at all. */
  savedLimit: number | null;
}

/** Typed refusal; the routes map `status` straight onto the response. */
export class ReportPlanError extends Error {
  readonly status: number;
  readonly code: string;
  readonly limit: number | null;

  constructor(code: string, message: string, options: { status?: number; limit?: number | null } = {}) {
    super(message);
    this.name = 'ReportPlanError';
    this.code = code;
    this.status = options.status ?? 402;
    this.limit = options.limit ?? null;
  }
}

function limitOf(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  return fallback;
}

export function reportAccess(entitlements: Entitlements | null | undefined): ReportAccess {
  if (!entitlements) {
    // Before the plan resolves, behave like the entry tier: the page can render
    // without flashing a builder that a Core account does not have.
    return { custom: false, historyDays: 90, savedLimit: 0 };
  }
  return {
    custom: entitlements.features.reports_advanced !== false && entitlements.entitled !== false,
    historyDays: limitOf(entitlements.limits?.report_history_days, 90),
    savedLimit: limitOf(entitlements.limits?.saved_reports, 0),
  };
}

export function canCustomize(access: ReportAccess): boolean {
  return access.custom;
}

export function canSave(access: ReportAccess): boolean {
  return access.custom && (access.savedLimit === null || access.savedLimit > 0);
}

export function assertCustomize(access: ReportAccess): void {
  if (!access.custom) {
    throw new ReportPlanError(
      'reports_custom_missing',
      'Custom reports are included in the Growth and Scale plans.',
    );
  }
}

/** Oldest day (inclusive) this plan may report on, or null when unlimited. */
export function earliestDay(access: ReportAccess, today: string): string | null {
  if (access.historyDays === null) return null;
  return addDays(today, -(Math.max(access.historyDays, 1) - 1));
}

export function assertHistory(access: ReportAccess, config: Pick<ReportConfig, 'from' | 'to'>, today: string): void {
  const earliest = earliestDay(access, today);
  if (earliest && config.from < earliest) {
    throw new ReportPlanError(
      'reports_history_limit',
      `This plan reports on the last ${access.historyDays} days.`,
      { status: 402, limit: access.historyDays },
    );
  }
  if (daysBetween(config.from, config.to) > 366) {
    throw new ReportPlanError('reports_period_too_long', 'A report covers at most a year.', {
      status: 400,
    });
  }
}

/**
 * Period-over-period comparison. Sold with the builder: it is the first thing a
 * manager asks of any number ("is that better than last month?"), and answering
 * it is what makes a report a decision instead of a screenshot.
 */
export function assertCompare(access: ReportAccess): void {
  if (!access.custom) {
    throw new ReportPlanError(
      'reports_compare_not_in_plan',
      'Comparing with the previous period is included in the Growth and Scale plans.',
    );
  }
}

export function assertSavedSlot(access: ReportAccess, currentCount: number): void {
  if (access.savedLimit === null) return;
  if (access.savedLimit === 0) {
    throw new ReportPlanError(
      'reports_saved_not_in_plan',
      'Saving reports is included in the Growth and Scale plans.',
    );
  }
  if (currentCount >= access.savedLimit) {
    throw new ReportPlanError(
      'reports_saved_limit',
      `This plan keeps ${access.savedLimit} saved reports.`,
      { status: 402, limit: access.savedLimit },
    );
  }
}
