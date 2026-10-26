import { describe, expect, it } from 'vitest';

import {
  dayDiff,
  dueReminders,
  MAX_REMINDERS,
  planReminder,
} from './reminders';

const policy = { daysBefore: 3, graceDays: 7 };

function invoice(overrides: Partial<Parameters<typeof planReminder>[0]> = {}) {
  return {
    id: 'inv-1',
    status: 'sent',
    dueDate: '2026-10-26',
    paidAt: null,
    lastReminderAt: null,
    remindersSent: 0,
    ...overrides,
  };
}

const due = new Date('2026-10-26T09:00:00Z');

describe('dayDiff', () => {
  it('counts whole days between instants', () => {
    expect(
      dayDiff(
        new Date('2026-10-20T00:00:00Z'),
        new Date('2026-10-26T00:00:00Z')
      )
    ).toBe(6);
    expect(
      dayDiff(
        new Date('2026-10-26T00:00:00Z'),
        new Date('2026-10-20T00:00:00Z')
      )
    ).toBe(-6);
  });
});

describe('planReminder', () => {
  it('does nothing before the reminder window', () => {
    expect(
      planReminder(invoice(), policy, new Date('2026-10-20T09:00:00Z'))
    ).toBeNull();
  });

  it('sends the upcoming reminder inside the window', () => {
    const decision = planReminder(
      invoice(),
      policy,
      new Date('2026-10-23T09:00:00Z')
    );
    expect(decision?.stage).toBe('upcoming');
    expect(decision?.daysPastDue).toBe(-3);
  });

  it('sends the overdue reminder on the due date', () => {
    const decision = planReminder(invoice(), policy, due);
    expect(decision?.stage).toBe('overdue');
    expect(decision?.daysPastDue).toBe(0);
  });

  it('skips a second reminder inside the 3-day cadence', () => {
    const decision = planReminder(
      invoice({ lastReminderAt: '2026-10-25T09:00:00Z', remindersSent: 1 }),
      policy,
      due
    );
    expect(decision).toBeNull();
  });

  it('sends a final notice after the grace period, once', () => {
    const first = planReminder(
      invoice({ lastReminderAt: '2026-11-01T09:00:00Z', remindersSent: 2 }),
      policy,
      new Date('2026-11-06T09:00:00Z')
    );
    expect(first?.stage).toBe('final');

    const again = planReminder(
      invoice({ lastReminderAt: '2026-11-06T09:00:00Z', remindersSent: 3 }),
      policy,
      new Date('2026-11-07T09:00:00Z')
    );
    expect(again).toBeNull();
  });

  it('never reminds a paid, void or draft invoice', () => {
    expect(
      planReminder(invoice({ paidAt: '2026-10-26T00:00:00Z' }), policy, due)
    ).toBeNull();
    expect(planReminder(invoice({ status: 'void' }), policy, due)).toBeNull();
    expect(planReminder(invoice({ status: 'draft' }), policy, due)).toBeNull();
  });

  it('stops at the cap', () => {
    expect(
      planReminder(
        invoice({ remindersSent: MAX_REMINDERS }),
        policy,
        new Date('2026-12-01T00:00:00Z')
      )
    ).toBeNull();
  });

  it('filters a batch', () => {
    const decisions = dueReminders(
      [
        invoice({ id: 'a', dueDate: '2026-10-26' }),
        invoice({ id: 'b', dueDate: '2026-12-31' }),
        invoice({ id: 'c', dueDate: '2026-10-26', status: 'paid' }),
      ],
      policy,
      due
    );
    expect(decisions.map((decision) => decision.invoiceId)).toEqual(['a']);
  });
});
