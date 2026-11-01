// ============================================================
// /api/reports/analyze — an AI reading of a report, on the account's key.
//
// Gates, in order:
//   1. `reports` (every plan) and the customization line — analysis exists on
//      a report you can shape.
//   2. `ai_agent` on the plan (Growth+).
//   3. An ACTIVE `ai_configs` row with the account's own provider key. That
//      row is the switch: an account that has not configured AI does not see
//      the feature, and the request is refused with `ai_not_configured`.
//
// Cost and data both stay with the client: their key, their provider, their
// bill. We send the aggregate table only — never message bodies.
// ============================================================

import { NextResponse } from 'next/server';

import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';
import { AiError } from '@/lib/ai/types';
import { toErrorResponse } from '@/lib/auth/account';
import { hasFeature } from '@/lib/plans/entitlements';
import { PlanError, requireFeature } from '@/lib/plans/guard';
import {
  ReportPlanError,
  assertCustomize,
  assertHistory,
  reportAccess,
} from '@/lib/reports/access';
import { buildAnalysisPrompt } from '@/lib/reports/analysis';
import { browserTimeZone, normalizeReportConfig, todayIn } from '@/lib/reports/catalog';
import { ReportRunError, runReport } from '@/lib/reports/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Is the button worth rendering?
 *
 * Three answers, one shape: the page must not show a feature that will 409 or
 * 402 when clicked, and it must not hide one the account can actually use.
 */
export async function GET() {
  try {
    const ctx = await requireFeature('reports');
    const access = reportAccess(ctx.entitlements);
    if (!access.custom) return NextResponse.json({ available: false, reason: 'reports_custom_missing' });
    if (!hasFeature(ctx.entitlements, 'ai_agent')) {
      return NextResponse.json({ available: false, reason: 'panel_plan' });
    }
    const ai = await loadAiConfig(ctx.supabase, ctx.accountId);
    return NextResponse.json({
      available: Boolean(ai),
      reason: ai ? null : 'ai_not_configured',
      model: ai ? `${ai.provider}/${ai.model}` : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireFeature('reports');
    const access = reportAccess(ctx.entitlements);

    try {
      assertCustomize(access);
    } catch (err) {
      if (err instanceof ReportPlanError) {
        return NextResponse.json({ error: err.code, detail: err.message }, { status: err.status });
      }
      throw err;
    }

    if (!hasFeature(ctx.entitlements, 'ai_agent')) {
      throw new PlanError('AI analysis is included in the Growth and Scale plans.', {
        code: 'plan_feature_missing',
        feature: 'ai_agent',
      });
    }

    const ai = await loadAiConfig(ctx.supabase, ctx.accountId);
    if (!ai) {
      return NextResponse.json({ error: 'ai_not_configured' }, { status: 409 });
    }

    const body = (await request.json().catch(() => null)) as
      | { config?: unknown; title?: unknown; currency?: unknown; locale?: unknown }
      | null;

    const timeZone = browserTimeZone();
    const today = todayIn(timeZone);

    let config;
    try {
      config = normalizeReportConfig(body?.config, {
        today,
        timeZone,
        allowAdvanced: access.custom,
      });
      assertHistory(access, config, today);
    } catch (err) {
      if (err instanceof ReportPlanError) {
        return NextResponse.json({ error: err.code, detail: err.message }, { status: err.status });
      }
      throw err;
    }

    let result;
    try {
      result = await runReport(ctx.supabase, config);
    } catch (err) {
      if (err instanceof ReportRunError) {
        return NextResponse.json({ error: 'invalid_report', detail: err.message }, { status: 400 });
      }
      throw err;
    }

    if (result.rows.length === 0) {
      // Nothing to analyse — say that instead of paying for a guess.
      return NextResponse.json({ error: 'empty_report' }, { status: 422 });
    }

    const locale = typeof body?.locale === 'string' ? body.locale : 'ar';
    const prompt = buildAnalysisPrompt(config, result, {
      title: typeof body?.title === 'string' ? body.title.slice(0, 120) : 'report',
      currency: typeof body?.currency === 'string' ? body.currency : undefined,
      locale,
    });

    try {
      const generated = await generateReply({
        config: ai,
        systemPrompt: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      });

      return NextResponse.json({
        analysis: generated.text.trim(),
        model: `${ai.provider}/${ai.model}`,
        basedOn: {
          from: result.from,
          to: result.to,
          rows: result.rowCount,
          totals: result.totals,
        },
      });
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json(
          { error: 'ai_failed', detail: err.message.slice(0, 200) },
          { status: 502 },
        );
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
