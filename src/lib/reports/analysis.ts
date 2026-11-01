// ============================================================
// Reports — AI reading of a report.
//
// The account's OWN provider key (`ai_configs`, BYO) does the work: no ExBolt
// key, no per-account cost, and the client's data goes to the provider the
// client chose. When AI is not configured and switched on in the account, the
// feature simply does not appear — that is the switch he asked for.
//
// What this is NOT: an oracle. The prompt is built from the aggregate table
// only (a few dozen numbers, never message bodies), the model is told it may
// only use those numbers, and the UI labels the output «قراءة مساعدة» with the
// figures it was given, so a manager can check it instead of trusting it.
// ============================================================

import { DATASETS, type ReportConfig } from './catalog';
import { formatMetric, type ReportResult } from './run';

export interface AnalysisInput {
  title: string;
  currency?: string;
  locale: string;
}

/** Smallest useful brief: the shape of the report plus its numbers. */
export function buildAnalysisPrompt(
  config: ReportConfig,
  result: ReportResult,
  input: AnalysisInput,
): { system: string; user: string } {
  const def = DATASETS[result.dataset];
  // Keys, not translated labels: the model reads `delivery_rate` as a rate,
  // and the UI is what turns it into «نسبة التسليم» for the human.
  const metricNames = result.columns
    .filter((column) => column.kind === 'number')
    .map((column) => column.key);

  const fmt = (value: unknown, key: string) =>
    formatMetric(value, unitOf(result, key), { locale: input.locale, currency: input.currency });

  const rows = result.rows.slice(0, 25).map((row) =>
    result.columns
      .map((column) =>
        column.kind === 'number'
          ? `${column.key}=${fmt(row[column.key], column.key)}`
          : `${column.key}=${String(row[column.key] ?? '—')}`,
      )
      .join(' | '),
  );

  const totals = result.columns
    .filter((column) => column.kind === 'number')
    .map((column) => `${column.key}=${fmt(result.totals[column.key], column.key)}`)
    .join(', ');

  const previous = result.previous
    ? result.columns
        .filter((column) => column.kind === 'number')
        .map((column) => `${column.key}=${fmt(result.previous?.totals?.[column.key], column.key)}`)
        .join(', ')
    : null;

  const arabic = input.locale.startsWith('ar');

  const system = arabic
    ? `أنت محلل بيانات في نظام CRM لمحادثات واتساب. مهمتك قراءة تقرير رقمي وتقديم قراءة مساعدة لمدير غير تقني.

قواعد صارمة:
1. استخدم الأرقام المعطاة فقط. ممنوع تمامًا اختراع رقم أو نسبة غير موجودة.
2. لو رقم ناقص أو صفر، قل ذلك صريحًا بدلًا من التخمين.
3. اكتب بالعربية المصرية المهنية، ٣ ملاحظات قصيرة كحد أقصى ثم ٢ اقتراح عملي.
4. ركّز على الأنماط (أعلى/أدنى، اتجاه، فجوات) مش على سرد الأرقام.
5. لا تدّعي سببًا لست متأكدًا منه؛ قل «محتاج مراجعة».
الشكل: نقاط قصيرة تبدأ بـ• — بدون مقدمات ولا خاتمة.`
    : `You analyse CRM data for WhatsApp conversations and write a short, plain-language reading of a numeric report.

Hard rules:
1. Use only the numbers given. Never invent a figure or a percentage.
2. If a number is missing or zero, say so instead of guessing.
3. At most three observations, then two practical suggestions.
4. Talk about patterns (high/low, direction, gaps), not a recital of the numbers.
5. Never assert a cause you are not sure of; say "needs a look".
Format: short bullets starting with • — no preamble, no closing.`;

  const lines = [
    `${arabic ? 'التقرير' : 'Report'}: ${input.title}`,
    `${arabic ? 'المصدر' : 'Dataset'}: ${def.key}`,
    `${arabic ? 'الفترة' : 'Period'}: ${result.from} → ${result.to} (${result.grain}, ${result.timeZone})`,
    `${arabic ? 'المقاييس' : 'Metrics'}: ${metricNames.join(', ')}`,
    '',
    `${arabic ? 'الإجمالي' : 'Totals'}: ${totals}`,
  ];

  if (previous) lines.push(`${arabic ? 'الفترة السابقة' : 'Previous period'}: ${previous}`);
  lines.push('', `${arabic ? 'الصفوف' : 'Rows'}:`, ...rows);
  if (result.truncated) {
    lines.push('', arabic ? '(تم عرض جزء من الصفوف)' : '(rows truncated)');
  }

  return { system, user: lines.join('\n') };
}

function unitOf(result: ReportResult, key: string) {
  const def = DATASETS[result.dataset];
  return def.metrics.find((metric) => metric.key === key)?.unit ?? 'count';
}
