import { describe, expect, it } from 'vitest';

import {
  formatInvoiceNumber,
  invoiceTotals,
  isOverdue,
  lineTotal,
  maxSequenceForYear,
  monthlyEquivalent,
  nextInvoiceNumber,
  roundMoney,
} from './invoice';

describe('roundMoney', () => {
  it('rounds to cents without float drift', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(Number.NaN)).toBe(0);
  });
});

describe('invoice totals', () => {
  it('multiplies quantity by unit price', () => {
    expect(
      lineTotal({ description: 'Seat', quantity: 3, unit_price: 129 })
    ).toBe(387);
  });

  it('sums lines and tax', () => {
    const totals = invoiceTotals(
      [
        { description: 'Growth plan', quantity: 1, unit_price: 129 },
        { description: 'Extra seat', quantity: 2, unit_price: 15.5 },
      ],
      14
    );
    expect(totals.subtotal).toBe(160);
    expect(totals.tax).toBe(14);
    expect(totals.total).toBe(174);
  });

  it('survives garbage from a JSON body', () => {
    const totals = invoiceTotals([
      { description: 'x', quantity: Number.NaN, unit_price: 10 },
    ]);
    expect(totals.total).toBe(0);
  });
});

describe('invoice numbering', () => {
  it('pads the sequence per year', () => {
    expect(formatInvoiceNumber('exb', 2026, 7)).toBe('EXB-2026-0007');
    expect(formatInvoiceNumber('', 2026, 1)).toBe('INV-2026-0001');
  });

  it('continues from the highest number of that year only', () => {
    const existing = [
      'EXB-2025-0099',
      'EXB-2026-0003',
      'EXB-2026-0011',
      'OTHER-2026-9999',
    ];
    expect(maxSequenceForYear(existing, 'EXB', 2026)).toBe(11);
    expect(nextInvoiceNumber(existing, 'EXB', 2026)).toBe('EXB-2026-0012');
    expect(nextInvoiceNumber(existing, 'EXB', 2027)).toBe('EXB-2027-0001');
  });
});

describe('isOverdue', () => {
  const now = new Date('2026-10-26T12:00:00Z');

  it('is true only for a sent invoice past its due date', () => {
    expect(isOverdue('sent', '2026-10-25', now)).toBe(true);
    expect(isOverdue('sent', '2026-10-26', now)).toBe(false);
    expect(isOverdue('draft', '2026-10-01', now)).toBe(false);
    expect(isOverdue('paid', '2026-10-01', now)).toBe(false);
    expect(isOverdue('void', '2026-10-01', now)).toBe(false);
  });

  it('ignores a missing due date', () => {
    expect(isOverdue('sent', null, now)).toBe(false);
  });
});

describe('monthlyEquivalent', () => {
  it('divides an annual price by 12', () => {
    expect(monthlyEquivalent(65, 715, 'annual')).toBe(59.58);
    expect(monthlyEquivalent(65, 715, 'monthly')).toBe(65);
  });

  it('falls back to monthly when the annual price is missing', () => {
    expect(monthlyEquivalent(129, null, 'annual')).toBe(129);
  });
});
