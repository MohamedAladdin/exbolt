import { describe, expect, it } from 'vitest';

import { renderReportHtml } from './document';

const BASE = {
  title: 'أداء الفريق',
  subtitle: 'ردود الفريق',
  brandName: 'عيادة النور',
  vendorName: 'ExCal.uk',
  vendorUrl: 'https://excal.uk',
  locale: 'ar',
  periodLabel: '2026-10-01 ← 2026-10-31',
  generatedAtLabel: 'أُنشئ في 1 نوفمبر 2026',
  columns: [
    { key: 'agent', label: 'الموظف', align: 'start' as const },
    { key: 'replies', label: 'الردود', align: 'end' as const },
  ],
  rows: [
    ['سارة', '42'],
    ['محمد', '19'],
  ],
  totals: ['', '61'],
  totalsLabel: 'الإجمالي',
  rowCountLabel: '2 صفوف',
  truncated: false,
  truncatedLabel: 'تم قص الصفوف',
  footerNote: null,
};

describe('renderReportHtml', () => {
  it('is right-to-left for Arabic and left-to-right for English', () => {
    expect(renderReportHtml(BASE)).toContain('dir="rtl"');
    expect(renderReportHtml({ ...BASE, locale: 'en' })).toContain('dir="ltr"');
  });

  it('escapes every user-controlled string', () => {
    const html = renderReportHtml({
      ...BASE,
      title: '<img src=x onerror=alert(1)>',
      brandName: 'A & B <script>',
      rows: [['<b>سارة</b>', '4 & 2']],
      footerNote: '"quoted"',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A &amp; B &lt;script&gt;');
    expect(html).toContain('&lt;b&gt;سارة&lt;/b&gt;');
    expect(html).toContain('&quot;quoted&quot;');
  });

  it('renders a totals footer and a truncation flag only when asked', () => {
    const html = renderReportHtml(BASE);
    expect(html).toContain('<tfoot>');
    expect(html).toContain('الإجمالي');
    expect(html).not.toContain('تم قص الصفوف');

    const truncated = renderReportHtml({ ...BASE, truncated: true, totals: null });
    expect(truncated).toContain('تم قص الصفوف');
    expect(truncated).not.toContain('<tfoot>');
  });

  it('numbers are end-aligned, labels start-aligned', () => {
    const html = renderReportHtml(BASE);
    expect(html).toContain('<th class="txt">الموظف</th>');
    expect(html).toContain('<th class="num">الردود</th>');
    expect(html).toContain('<td class="num">42</td>');
  });

  it('is a self-contained printable document', () => {
    const html = renderReportHtml(BASE);
    expect(html).toContain('@page { size: A4;');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toContain('<link');
  });
});
