import { describe, expect, it } from 'vitest';

import { contentDisposition, csvCell, reportFileName, reportToCsv } from './csv';
import type { ReportResult } from './run';

const HEADERS = { period: 'الفترة', messages: 'رسائل', delivery_rate: 'نسبة التسليم', __totals: 'الإجمالي' };

function result(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    dataset: 'messages',
    from: '2026-10-01',
    to: '2026-10-02',
    timeZone: 'Africa/Cairo',
    grain: 'day',
    columns: [
      { key: 'period', kind: 'time' },
      { key: 'messages', kind: 'number' },
      { key: 'delivery_rate', kind: 'number' },
    ],
    rows: [
      { period: '2026-10-01T00:00:00+00:00', messages: 12, delivery_rate: 98.5 },
      { period: '2026-10-02T00:00:00+00:00', messages: 7, delivery_rate: null },
    ],
    totals: { messages: 19, delivery_rate: 97.2 },
    rowCount: 2,
    truncated: false,
    limit: 1000,
    ...overrides,
  };
}

describe('csvCell', () => {
  it('quotes only what needs quoting', () => {
    expect(csvCell('رسائل')).toBe('رسائل');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('neutralises spreadsheet formulas', () => {
    // A contact named `=HYPERLINK(...)` must not become a live formula when
    // the manager opens the export in Excel.
    expect(csvCell('=cmd|calc')).toBe('"=cmd|calc"');
    expect(csvCell('+20 100 000 0000')).toBe('"+20 100 000 0000"');
  });

  it('renders null as an empty cell, not "null"', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
  });
});

describe('reportToCsv', () => {
  it('starts with a BOM so Excel reads the Arabic headers', () => {
    const csv = reportToCsv(result(), HEADERS);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('uses CRLF and writes numbers unformatted', () => {
    const csv = reportToCsv(result(), HEADERS).slice(1);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('الفترة,رسائل,نسبة التسليم');
    expect(lines[1]).toBe('2026-10-01T00:00:00+00:00,12,98.5');
    // A null metric is an empty cell, never the word "null".
    expect(lines[2]).toBe('2026-10-02T00:00:00+00:00,7,');
  });

  it('appends a labelled totals line only when there is more than one row', () => {
    const withTotals = reportToCsv(result(), HEADERS).slice(1).split('\r\n');
    expect(withTotals[3]).toBe('الإجمالي,19,97.2');

    const single = reportToCsv(
      result({ rows: [{ period: '2026-10-01T00:00:00+00:00', messages: 12, delivery_rate: 98.5 }] }),
      HEADERS,
    );
    expect(single.slice(1).split('\r\n').filter(Boolean)).toHaveLength(2); // header + row
  });

  it('keeps the download header ASCII so the response cannot throw', () => {
    const header = contentDisposition('أداء-الفريق-2026-10-01.csv', 'team-2026-10-01.csv');
    // A response header is a ByteString — any code point above 255 throws.
    for (const char of header) {
      expect(char.codePointAt(0)!).toBeLessThanOrEqual(255);
    }
    expect(header).toContain('filename="team-2026-10-01.csv"');
    expect(header).toContain("filename*=UTF-8''");
  });

  it('transliterates the file name and keeps the period', () => {
    const name = reportFileName(result(), 'أداء الفريق / أكتوبر');
    expect(name).toBe('أداء-الفريق-أكتوبر-2026-10-01-2026-10-02.csv');
    expect(reportFileName(result(), '   ')).toBe('messages-2026-10-01-2026-10-02.csv');
  });
});
