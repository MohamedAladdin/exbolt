// ============================================================
// /api/reports/cron — deliver the scheduled reports that are due.
//
// Guarded by AUTOMATION_CRON_SECRET (`x-cron-secret`), the same convention the
// automations and flows pingers already use, so one cron file can drive all of
// them.
//
// Each tick:
//   1. `due_report_schedules()` decides what is due in the account's local
//      clock (service-role only; a tenant session can never call it).
//   2. The saved report's config is re-anchored to "the same number of days
//      ending today" — a saved report stores a shape, not a date range, and a
//      Monday email must not silently mail last March.
//   3. `_run_report(account, config)` aggregates, the mail is rendered and
//      sent, and `last_sent_at` / `last_error` record what happened.
//
// Responses are counters, never prose: `schedules / sent / dryRun / failed`.
// ============================================================

import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/admin/db';
import { brandName, VENDOR_NAME } from '@/lib/branding';
import { addDays, agentPlaceholderKey, daysBetween, metricUnit, todayIn, type ReportConfig } from '@/lib/reports/catalog';
import { alertSummary, breaches, type Comparator } from '@/lib/reports/alerts';
import { formatMetric } from '@/lib/reports/run';
import { renderReportEmail, sendReportEmail } from '@/lib/reports/email';
import { columnLabel, emailLabels } from '@/lib/reports/email-labels';
import { prepareReportTable } from '@/lib/reports/render';
import type { ReportResult } from '@/lib/reports/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface DueSchedule {
  schedule_id: string;
  account_id: string;
  saved_report_id: string;
  report_name: string;
  report_config: ReportConfig;
  recipients: string[];
  format: 'csv' | 'html';
  time_zone: string;
  cadence: 'weekly' | 'monthly';
}

export async function POST(request: Request) {
  const secret = process.env.AUTOMATION_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  if (request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = adminDb();
  const { data, error } = await db.rpc('due_report_schedules');
  if (error) {
    console.error('[reports/cron] due lookup failed:', error.message);
    return NextResponse.json({ error: 'due_lookup_failed' }, { status: 500 });
  }

  const schedules = (data ?? []) as DueSchedule[];
  let sent = 0;
  let dryRun = 0;
  let failed = 0;

  for (const schedule of schedules) {
    try {
      const config = reanchor(schedule.report_config, schedule.time_zone);
      const { data: result, error: runError } = await db.rpc('_run_report', {
        p_account: schedule.account_id,
        p_config: config,
      });

      if (runError) {
        await markSchedule(db, schedule.schedule_id, `run_failed: ${runError.message}`);
        failed += 1;
        continue;
      }

      const outcome = await deliver(db, schedule, config, result as ReportResult);
      if (outcome === 'sent') {
        sent += 1;
        await markSchedule(db, schedule.schedule_id, null);
      } else if (outcome === 'dry_run') {
        dryRun += 1;
        await markSchedule(db, schedule.schedule_id, 'dry_run: smtp_not_configured');
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      await markSchedule(db, schedule.schedule_id, `error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  // Alerts ride the same tick: one aggregate per rule, and the cooldown lives
  // on the rule so a metric parked above its threshold notifies once.
  const alerts = await evaluateAlerts(db);

  return NextResponse.json({
    schedules: schedules.length,
    sent,
    dryRun,
    failed,
    alertsChecked: alerts.checked,
    alertsFired: alerts.fired,
  });
}

/** A saved report stores a window *length*; the mail always ends today. */
function reanchor(config: ReportConfig, timeZone: string): ReportConfig {
  const today = todayIn(timeZone);
  const span = Math.max(1, daysBetween(config.from, config.to));
  return { ...config, from: addDays(today, -(span - 1)), to: today, tz: timeZone };
}

async function deliver(
  db: ReturnType<typeof adminDb>,
  schedule: DueSchedule,
  config: ReportConfig,
  result: ReportResult,
): Promise<'sent' | 'dry_run' | 'failed'> {
  // Locale follows the account's branding language: Arabic unless the account
  // has no Arabic name at all (the same signal the shell uses).
  const { data: account } = await db
    .from('accounts')
    .select('name, brand_name')
    .eq('id', schedule.account_id)
    .maybeSingle();

  const locale = 'ar';
  const labels = emailLabels(locale);
  const headers: Record<string, string> = {};
  for (const column of result.columns) {
    headers[column.key] = columnLabel(labels, column.key);
  }

  const table = prepareReportTable(result, {
    locale,
    labels: headers,
    totalsLabel: labels.totals,
    agentPlaceholder: labels.agentPlaceholder(agentPlaceholderKey(result.dataset)),
  });

  const generated = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: schedule.time_zone,
  }).format(new Date());

  const rendered = renderReportEmail({
    title: schedule.report_name,
    brandName: brandName((account?.brand_name as string | null) ?? (account?.name as string | null)),
    vendorName: VENDOR_NAME,
    locale,
    periodLabel: labels.period(result.from, result.to),
    generatedLabel: labels.generated(generated),
    footerNote: labels.footer,
    truncatedNote: result.truncated ? labels.truncated : null,
    table,
    linkUrl: process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/reports`
      : 'https://bolt.excal.uk/reports',
    linkLabel: labels.openReport,
  });

  const outcome = await sendReportEmail({
    to: schedule.recipients,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  if (outcome.status === 'failed') {
    await markSchedule(db, schedule.schedule_id, `mail_failed: ${outcome.error ?? 'unknown'}`);
  }
  return outcome.status;
}

async function markSchedule(
  db: ReturnType<typeof adminDb>,
  scheduleId: string,
  error: string | null,
): Promise<void> {
  await db
    .from('report_schedules')
    .update({
      // Every attempt stamps `last_attempt_at` (so a broken schedule is not
      // retried on every tick), but only a real send moves `last_sent_at`.
      last_attempt_at: new Date().toISOString(),
      ...(error
        ? { last_error: error.slice(0, 300) }
        : { last_sent_at: new Date().toISOString(), last_error: null }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', scheduleId);
}

interface DueAlert {
  alert_id: string;
  account_id: string;
  saved_report_id: string;
  report_name: string;
  report_config: ReportConfig;
  metric: string;
  comparator: Comparator;
  threshold: number;
  last_value: number | null;
}

async function evaluateAlerts(db: ReturnType<typeof adminDb>): Promise<{ checked: number; fired: number }> {
  const { data, error } = await db.rpc('due_report_alerts');
  if (error) {
    console.error('[reports/cron] alert lookup failed:', error.message);
    return { checked: 0, fired: 0 };
  }

  const rules = (data ?? []) as DueAlert[];
  let fired = 0;

  for (const rule of rules) {
    const config = reanchor(rule.report_config, rule.report_config.tz ?? 'Africa/Cairo');
    const { data: result, error: runError } = await db.rpc('_run_report', {
      p_account: rule.account_id,
      p_config: { ...config, compare: false },
    });

    const total = runError ? null : ((result as ReportResult)?.totals?.[rule.metric] ?? null);
    const numeric = total == null ? null : Number(total);
    const hit = breaches(numeric, rule);

    const now = new Date().toISOString();
    await db
      .from('report_alerts')
      .update({ last_checked_at: now, last_value: numeric, updated_at: now })
      .eq('id', rule.alert_id);

    if (!hit) continue;

    // Cooldown is evaluated against the last *fire*, not the last check.
    const { data: current } = await db
      .from('report_alerts')
      .select('last_fired_at, cooldown_hours')
      .eq('id', rule.alert_id)
      .maybeSingle();

    const lastFired = current?.last_fired_at ? new Date(current.last_fired_at as string).getTime() : 0;
    const cooldownMs = Number(current?.cooldown_hours ?? 24) * 3_600_000;
    if (lastFired && Date.now() - lastFired < cooldownMs) continue;

    await notifyAdmins(db, rule, numeric);
    await db.from('report_alerts').update({ last_fired_at: now }).eq('id', rule.alert_id);
    fired += 1;
  }

  return { checked: rules.length, fired };
}

/** One notification per owner/admin — an alert nobody reads is not an alert. */
async function notifyAdmins(
  db: ReturnType<typeof adminDb>,
  rule: DueAlert,
  value: number | null,
): Promise<void> {
  const { data: admins } = await db
    .from('profiles')
    .select('user_id, account_role')
    .eq('account_id', rule.account_id)
    .in('account_role', ['owner', 'admin']);

  const unit = metricUnit(rule.report_config.dataset, rule.metric);
  const summary = alertSummary(rule, value, (v, metric) =>
    formatMetric(v, metricUnit(rule.report_config.dataset, metric), { locale: 'ar' }),
  );

  const rows = (admins ?? []).map((admin) => ({
    account_id: rule.account_id,
    user_id: admin.user_id as string,
    type: 'report_alert',
    title: rule.report_name,
    body: summary,
  }));

  if (rows.length > 0) {
    const { error } = await db.from('notifications').insert(rows);
    if (error) console.error('[reports/cron] notify failed:', error.message);
  }

  // Kept for the log line; the unit already shaped the summary.
  void unit;
}
