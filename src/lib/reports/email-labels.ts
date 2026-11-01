// ============================================================
// Reports — server-side label lookup for scheduled emails.
//
// The client gets its strings from next-intl; a cron tick has no request and no
// locale cookie, so the catalogues are imported directly here. One import site,
// so the mail and the app can never disagree about what `with_reply` is called.
// ============================================================

import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';

type Catalog = typeof ar;

const CATALOGUES: Record<string, Catalog> = { ar, en };

export interface EmailLabels {
  title: (savedName: string) => string;
  metric: (key: string) => string;
  dimension: (key: string) => string;
  dataset: (key: string) => string;
  totals: string;
  period: (from: string, to: string) => string;
  generated: (when: string) => string;
  openReport: string;
  footer: string;
  truncated: string;
  agentPlaceholder: (key: string) => string;
}

export function emailLabels(locale: string): EmailLabels {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES.ar;
  const reports = catalogue.Reports as unknown as Record<string, Record<string, string>>;

  const metric = (key: string) => reports.metrics?.[key] ?? key;
  const dimension = (key: string) => reports.dimensions?.[key] ?? key;

  return {
    title: (savedName: string) => savedName,
    metric,
    dimension,
    dataset: (key: string) => reports.datasets?.[key] ?? key,
    totals: typeof reports.totals === 'string' ? reports.totals : 'الإجمالي',
    period: (from: string, to: string) => `${from} ← ${to}`,
    generated: (when: string) => (locale === 'ar' ? `أُنشئ في ${when}` : `Generated ${when}`),
    openReport: locale === 'ar' ? 'افتح التقرير' : 'Open the report',
    footer:
      locale === 'ar'
        ? 'أرقام محسوبة من سجل المحادثات لحظة الإرسال.'
        : 'Figures computed from the conversation history at send time.',
    truncated:
      locale === 'ar'
        ? 'يتم عرض جزء من الصفوف — ضيّق الفترة أو أضف فلترًا في النظام.'
        : 'Showing part of the rows — narrow the period or add a filter in the app.',
    agentPlaceholder: (key: string) =>
      reports.agentPlaceholder?.[key] ?? (locale === 'ar' ? 'بدون موظف مسجّل' : 'No recorded member'),
  };
}

/** Column header for a report column key (metric or dimension). */
export function columnLabel(labels: EmailLabels, key: string): string {
  const known = ['period', 'channel', 'agent', 'status', 'tag', 'number', 'pipeline', 'stage', 'broadcast'];
  return known.includes(key) ? labels.dimension(key) : labels.metric(key);
}
