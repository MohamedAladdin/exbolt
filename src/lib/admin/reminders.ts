/**
 * Payment reminders — pure policy, no I/O.
 *
 * One policy, three stages, so the rule is explainable to a client:
 *
 *   upcoming  N days before the due date       (default N = 3)
 *   overdue   on the due date
 *   final     once, `graceDays` after the due date
 *
 * and never more than `MAX_REMINDERS` per invoice, never twice inside
 * `REMINDER_INTERVAL_DAYS`. A paid, void or draft invoice is never
 * reminded. The caller applies the decision to the DB and sends the mail;
 * this module only decides.
 */

export type ReminderStage = 'upcoming' | 'overdue' | 'final';

export interface ReminderPolicy {
  daysBefore: number;
  graceDays: number;
}

export interface ReminderCandidate {
  id: string;
  status: string;
  dueDate: string;
  paidAt?: string | null;
  lastReminderAt?: string | null;
  remindersSent: number;
}

export interface ReminderDecision {
  invoiceId: string;
  stage: ReminderStage;
  /** Whole days past due; negative before the due date. */
  daysPastDue: number;
}

export const REMINDER_INTERVAL_DAYS = 3;
export const MAX_REMINDERS = 4;

const MS_DAY = 86_400_000;

function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Whole days between two instants, floored at day granularity. */
export function dayDiff(from: Date, to: Date): number {
  return Math.floor((startOfDay(to) - startOfDay(from)) / MS_DAY);
}

export function planReminder(
  invoice: ReminderCandidate,
  policy: ReminderPolicy,
  now: Date = new Date()
): ReminderDecision | null {
  if (invoice.paidAt) return null;
  if (!['sent', 'overdue'].includes(invoice.status)) return null;
  if (invoice.remindersSent >= MAX_REMINDERS) return null;

  const due = new Date(`${invoice.dueDate}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return null;

  const daysPastDue = dayDiff(due, now);

  // Stage selection first: the cadence only decides *when* within a stage.
  let stage: ReminderStage;
  if (daysPastDue < 0 && -daysPastDue <= policy.daysBefore) stage = 'upcoming';
  else if (daysPastDue >= 0 && daysPastDue <= policy.graceDays)
    stage = 'overdue';
  else if (daysPastDue > policy.graceDays) stage = 'final';
  else return null; // still before the reminder window

  // The final notice goes out once, however long the invoice stays unpaid.
  if (stage === 'final' && invoice.remindersSent > 0) {
    const last = invoice.lastReminderAt
      ? new Date(invoice.lastReminderAt)
      : null;
    const lastWasFinal = last ? dayDiff(due, last) > policy.graceDays : false;
    if (lastWasFinal) return null;
  }

  if (invoice.lastReminderAt) {
    const last = new Date(invoice.lastReminderAt);
    if (!Number.isNaN(last.getTime())) {
      const sinceLast = dayDiff(last, now);
      if (sinceLast < REMINDER_INTERVAL_DAYS && stage !== 'final') return null;
      if (sinceLast <= 0 && stage === 'final') return null;
    }
  }

  return { invoiceId: invoice.id, stage, daysPastDue };
}

export function dueReminders(
  invoices: readonly ReminderCandidate[],
  policy: ReminderPolicy,
  now: Date = new Date()
): ReminderDecision[] {
  const out: ReminderDecision[] = [];
  for (const invoice of invoices) {
    const decision = planReminder(invoice, policy, now);
    if (decision) out.push(decision);
  }
  return out;
}
