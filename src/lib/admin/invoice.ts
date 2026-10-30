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
 * Unambiguous alphabet for invoice codes: no `0/O`, `1/I/L`, `B/8`, `S/5`
 * — a number that is read over the phone or copied off a screenshot must
 * survive the trip. 30 chars, 6 positions = 729M combinations per year.
 */
export const INVOICE_CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY234679';

export function randomInvoiceCode(
  rng: () => number = Math.random,
  length = 6
): string {
  const alphabet = INVOICE_CODE_ALPHABET;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const raw = rng();
    const index = Math.floor(
      (Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0) *
        alphabet.length
    );
    let ch = alphabet[index] ?? 'A';
    // A run like `YYY` reads as a typo on a printed invoice; nudge it.
    if (i >= 2 && out[i - 1] === ch && out[i - 2] === ch) {
      ch = alphabet[(index + 1) % alphabet.length];
    }
    out += ch;
  }
  return out;
}

/**
 * Public invoice number: `<PREFIX>-<YYYY>-<6 random chars>`.
 *
 * Sequential numbers (`EXB-2026-0001`) tell every customer they are the
 * first sale of the year — a competitor reads the whole business from the
 * invoice footer. Random, unique and still human-readable: unguessable
 * count, sortable by the embedded year, no ambiguous characters.
 * Uniqueness is enforced by the DB; callers retry on 23505.
 */
export function randomInvoiceNumber(
  prefix: string,
  year: number,
  rng: () => number = Math.random
): string {
  const cleanPrefix =
    prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'INV';
  return `${cleanPrefix}-${year}-${randomInvoiceCode(rng)}`;
}

/**
 * Legacy sequential numbering — kept for the invoices issued before the
 * random scheme (and for reading old PDFs); never used for new rows.
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
