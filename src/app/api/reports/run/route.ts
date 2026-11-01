// ============================================================
// /api/reports/run — execute a report.
//
// Two shapes, and the difference IS the paywall:
//
//   { preset: "volume", days: 30 }   any plan — the config is built from the
//                                    catalogue here, so the account cannot
//                                    invent metrics or dimensions; `days` is
//                                    checked against the plan's history floor.
//   { config: {...} }                Growth+ only — the builder.
//
// A single "accept whatever config" endpoint could not tell a preset from a
// custom report, which would make the Core line decorative. Building the
// preset config server-side is what makes it real.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireFeature } from '@/lib/plans/guard';
import {
  DATASETS,
  PRESETS,
  ReportConfigError,
  browserTimeZone,
  normalizeReportConfig,
  presetConfig,
  todayIn,
  type ReportConfig,
} from '@/lib/reports/catalog';
import {
  ReportPlanError,
  assertCompare,
  assertCustomize,
  assertHistory,
  reportAccess,
} from '@/lib/reports/access';
import { ReportRunError, runReport } from '@/lib/reports/run';

const PRESET_DAYS = [7, 30, 90] as const;

export async function POST(request: Request) {
  try {
    const ctx = await requireFeature('reports');
    const body = (await request.json().catch(() => null)) as
      | { config?: unknown; preset?: unknown; days?: unknown; compare?: unknown }
      | null;

    const timeZone = browserTimeZone();
    const today = todayIn(timeZone);
    const access = reportAccess(ctx.entitlements);

    let config: ReportConfig;

    try {
      if (typeof body?.preset === 'string') {
        const preset = PRESETS.find((item) => item.id === body.preset);
        if (!preset) {
          return NextResponse.json({ error: 'unknown_preset' }, { status: 400 });
        }
        const requested = Number(body?.days);
        const days = (PRESET_DAYS as readonly number[]).includes(requested)
          ? requested
          : Math.min(preset.days, access.historyDays ?? preset.days);
        assertPresetMetrics(preset.dataset, preset.metrics, access.custom);
        config = presetConfig(preset, { today, timeZone, days });
        // A ready-made report may also be read against the previous period —
        // still a Growth+ capability, and still built server-side.
        if (body.compare === true && access.custom) config = { ...config, compare: true };
      } else {
        assertCustomize(access);
        config = normalizeReportConfig(body?.config, {
          today,
          timeZone,
          allowAdvanced: access.custom,
        });
      }
      if (config.compare) assertCompare(access);
      assertHistory(access, config, today);
    } catch (err) {
      return planOrConfigResponse(err);
    }

    try {
      const result = await runReport(ctx.supabase, config);
      // The normalised config goes back with the answer: the UI shows the
      // period it actually ran over, which is not always what was typed
      // (an empty date field becomes "last 30 days").
      return NextResponse.json({ config, result, access });
    } catch (err) {
      if (err instanceof ReportRunError) {
        return NextResponse.json({ error: 'invalid_report', detail: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * A preset may measure something a Core account does not have (p90 response,
 * campaign reply rate). The catalogue already knows which metrics those are,
 * so this reads the flag instead of keeping a second list.
 */
function assertPresetMetrics(dataset: ReportConfig['dataset'], metrics: string[], custom: boolean): void {
  if (custom) return;
  const advanced = new Set(
    DATASETS[dataset].metrics.filter((metric) => metric.advanced).map((metric) => metric.key),
  );
  if (metrics.some((metric) => advanced.has(metric))) {
    throw new ReportPlanError(
      'metric_not_in_plan',
      'These metrics are included in the Growth and Scale plans.',
    );
  }
}

function planOrConfigResponse(err: unknown) {
  if (err instanceof ReportPlanError) {
    return NextResponse.json(
      { error: err.code, detail: err.message, limit: err.limit },
      { status: err.status },
    );
  }
  if (err instanceof ReportConfigError) {
    return NextResponse.json({ error: err.code, detail: err.message }, { status: 400 });
  }
  throw err;
}
