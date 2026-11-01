import { describe, expect, it } from 'vitest';

import type { Entitlements } from '@/lib/plans/entitlements';
import {
  ReportPlanError,
  assertCompare,
  assertCustomize,
  assertHistory,
  assertSavedSlot,
  canSave,
  earliestDay,
  reportAccess,
} from './access';

/** Minimal entitlement shape — only the fields `reportAccess` reads. */
function entitlements(
  features: Record<string, boolean | undefined>,
  limits: Record<string, number | null | undefined>,
): Entitlements {
  return { features, limits, entitled: true } as unknown as Entitlements;
}

const CORE = entitlements(
  { reports: true, reports_advanced: false, exports: true },
  { report_history_days: 90, saved_reports: 0 },
);
const GROWTH = entitlements(
  { reports: true, reports_advanced: true },
  { report_history_days: 365, saved_reports: 50 },
);
const SCALE = entitlements(
  { reports: true, reports_advanced: true },
  { report_history_days: null, saved_reports: null },
);

const TODAY = '2026-11-01';

describe('reportAccess', () => {
  it('reads the three lines the packaging sells', () => {
    expect(reportAccess(CORE)).toEqual({ custom: false, historyDays: 90, savedLimit: 0 });
    expect(reportAccess(GROWTH)).toEqual({ custom: true, historyDays: 365, savedLimit: 50 });
    expect(reportAccess(SCALE)).toEqual({ custom: true, historyDays: null, savedLimit: null });
  });

  it('behaves like the entry tier before the plan resolves', () => {
    expect(reportAccess(null)).toEqual({ custom: false, historyDays: 90, savedLimit: 0 });
  });

  it('treats a suspended account as non-custom even if the plan says otherwise', () => {
    const suspended = { ...GROWTH, entitled: false } as Entitlements;
    expect(reportAccess(suspended).custom).toBe(false);
  });

  it('falls back to the Core ceiling when the limit keys are missing', () => {
    const legacy = entitlements({ reports: true, reports_advanced: true }, {});
    expect(reportAccess(legacy)).toEqual({ custom: true, historyDays: 90, savedLimit: 0 });
  });
});

describe('customization gate', () => {
  it('refuses Core and allows Growth', () => {
    expect(() => assertCustomize(reportAccess(CORE))).toThrow(ReportPlanError);
    expect(() => assertCustomize(reportAccess(GROWTH))).not.toThrow();
    expect(canSave(reportAccess(CORE))).toBe(false);
    expect(canSave(reportAccess(GROWTH))).toBe(true);
  });
});

describe('comparison gate', () => {
  it('is a Growth+ capability', () => {
    expect(() => assertCompare(reportAccess(CORE))).toThrow(ReportPlanError);
    expect(() => assertCompare(reportAccess(GROWTH))).not.toThrow();
    expect(() => assertCompare(reportAccess(SCALE))).not.toThrow();
  });
});

describe('history floor', () => {
  it('computes the oldest allowed day', () => {
    expect(earliestDay(reportAccess(CORE), TODAY)).toBe('2026-08-04');
    expect(earliestDay(reportAccess(GROWTH), TODAY)).toBe('2025-11-02');
    expect(earliestDay(reportAccess(SCALE), TODAY)).toBeNull();
  });

  it('refuses a window that starts before the plan floor', () => {
    const access = reportAccess(CORE);
    expect(() => assertHistory(access, { from: '2026-08-04', to: TODAY }, TODAY)).not.toThrow();
    const err = (() => {
      try {
        assertHistory(access, { from: '2026-08-03', to: TODAY }, TODAY);
        return null;
      } catch (e) {
        return e as ReportPlanError;
      }
    })();
    expect(err?.code).toBe('reports_history_limit');
    expect(err?.status).toBe(402);
    expect(err?.limit).toBe(90);
  });

  it('lets an unlimited plan report on any period inside a year', () => {
    expect(() =>
      assertHistory(reportAccess(SCALE), { from: '2019-01-01', to: '2020-01-01' }, TODAY),
    ).not.toThrow();
  });

  it('caps a single report at a year even on Scale', () => {
    const err = (() => {
      try {
        assertHistory(reportAccess(SCALE), { from: '2024-01-01', to: '2026-01-01' }, TODAY);
        return null;
      } catch (e) {
        return e as ReportPlanError;
      }
    })();
    expect(err?.code).toBe('reports_period_too_long');
    expect(err?.status).toBe(400);
  });
});

describe('saved-report ceiling', () => {
  it('tells "not in the plan" apart from "you hit the cap"', () => {
    const core = reportAccess(CORE);
    expect(() => assertSavedSlot(core, 0)).toThrow(/Growth and Scale/);

    const growth = reportAccess(GROWTH);
    expect(() => assertSavedSlot(growth, 49)).not.toThrow();
    const err = (() => {
      try {
        assertSavedSlot(growth, 50);
        return null;
      } catch (e) {
        return e as ReportPlanError;
      }
    })();
    expect(err?.code).toBe('reports_saved_limit');
    expect(err?.limit).toBe(50);

    expect(() => assertSavedSlot(reportAccess(SCALE), 5000)).not.toThrow();
  });
});
