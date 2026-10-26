/**
 * Invoice arithmetic and numbering — pure, unit-tested, no I/O.
 *
 * Money is stored as NUMERIC in Postgres and arrives here as a string.
 * Every helper converts to a number at the edge and rounds to 2 decimals
 * with `roundMoney`, so a rounding difference can never make the printed
 * total disagree with the stored one.
 */

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';

export interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
}

export interface InvoiceTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/** Round half-up to cents without float drift (0.1 + 0.2 landmine). */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toMoney(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return roundMoney(Number.isFinite(parsed) ? parsed : 0);
}

export function lineTotal(item: LineItem): number {
  const quantity = Number.isFinite(item.quantity) ? item.quantity : 0;
  return roundMoney(toMoney(item.unit_price) * quantity);
}

export function invoiceTotals(
  items: LineItem[],
  tax: unknown = 0
): InvoiceTotals {
  const subtotal = roundMoney(
    items.reduce((sum, item) => sum + lineTotal(item), 0)
  );
  const taxAmount = roundMoney(toMoney(tax));
  return { subtotal, tax: taxAmount, total: roundMoney(subtotal + taxAmount) };
}

/**
 * Invoice number: `<PREFIX>-<YYYY>-<NNNN>`, sequence restarting each year.
 *
 * The sequence is derived from the numbers already issued for that year
 * rather than a DB sequence, so a manually imported invoice cannot collide
 * with the next auto-number (`create_invoice` still enforces UNIQUE, and
 * the caller retries once on a duplicate-key error).
 */
export function formatInvoiceNumber(
  prefix: string,
  year: number,
  sequence: number
): string {
  const cleanPrefix =
    prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'INV';
  return `${cleanPrefix}-${year}-${String(sequence).padStart(4, '0')}`;
}

export function maxSequenceForYear(
  existing: readonly string[],
  prefix: string,
  year: number
): number {
  const cleanPrefix =
    prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'INV';
  const pattern = new RegExp(`^${cleanPrefix}-${year}-(\\d{1,6})$`);
  let max = 0;
  for (const number of existing) {
    const match = pattern.exec(number);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

export function nextInvoiceNumber(
  existing: readonly string[],
  prefix: string,
  year: number
): string {
  return formatInvoiceNumber(
    prefix,
    year,
    maxSequenceForYear(existing, prefix, year) + 1
  );
}

/** A `sent` invoice past its due date is overdue; paid/void/draft never are. */
export function isOverdue(
  status: InvoiceStatus,
  dueDate: string | null,
  now: Date = new Date()
): boolean {
  if (status !== 'sent') return false;
  if (!dueDate) return false;
  const due = new Date(`${dueDate}T23:59:59Z`);
  if (Number.isNaN(due.getTime())) return false;
  return now.getTime() > due.getTime();
}

/** Monthly-equivalent amount for the MRR tile. */
export function monthlyEquivalent(
  priceMonthly: unknown,
  priceAnnual: unknown,
  interval: 'monthly' | 'annual'
): number {
  if (interval === 'annual') {
    const annual = toMoney(priceAnnual);
    if (annual > 0) return roundMoney(annual / 12);
  }
  return toMoney(priceMonthly);
}

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  sent: 'border-sky-500/40 bg-sky-500/10 text-sky-400',
  paid: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  overdue: 'border-red-500/40 bg-red-500/10 text-red-400',
  void: 'border-border bg-muted text-muted-foreground line-through',
};
