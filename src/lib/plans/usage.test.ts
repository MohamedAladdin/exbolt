import { describe, expect, it } from 'vitest';

import {
  channelSlotState,
  countActiveChannels,
  countAiAgents,
  countBroadcastMessagesThisMonth,
  countTeamSeats,
} from './usage';

/**
 * The counters only ever do `from(table).select(cols).eq(account, …)` (plus
 * `.in()` for broadcasts), so a table→rows map is enough of a Supabase double.
 */
function fakeDb(tables: Record<string, unknown[]>) {
  const build = (table: string) => {
    const rows = tables[table] ?? [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return chain;
  };
  return { from: (table: string) => build(table) } as never;
}

describe('countActiveChannels', () => {
  it('counts every WhatsApp number plus active messaging channels', async () => {
    const db = fakeDb({
      whatsapp_config: [{ id: 'w1' }, { id: 'w2' }],
      channel_configs: [
        { id: 'c1', is_active: true },
        { id: 'c2', is_active: false },
      ],
    });

    await expect(countActiveChannels(db, 'acct')).resolves.toBe(3);
  });

  it('is zero for an empty account', async () => {
    await expect(countActiveChannels(fakeDb({}), 'acct')).resolves.toBe(0);
  });
});

describe('channelSlotState', () => {
  const db = fakeDb({
    whatsapp_config: [{ id: 'w1', phone_number_id: '111' }],
    channel_configs: [
      { id: 'c1', channel: 'messenger', external_id: '900', is_active: true },
    ],
  });

  it('treats the same WhatsApp number as an update, not a new slot', async () => {
    await expect(channelSlotState(db, 'acct', 'whatsapp', '111')).resolves.toEqual(
      { connected: true, used: 2 }
    );
  });

  it('treats a different number as a new slot', async () => {
    await expect(channelSlotState(db, 'acct', 'whatsapp', '222')).resolves.toEqual(
      { connected: false, used: 2 }
    );
  });

  it('matches messaging channels by id so re-choosing the same Page is free', async () => {
    await expect(
      channelSlotState(db, 'acct', 'messenger', '900')
    ).resolves.toEqual({ connected: true, used: 2 });
    await expect(
      channelSlotState(db, 'acct', 'messenger', '901')
    ).resolves.toEqual({ connected: false, used: 2 });
  });
});

describe('countTeamSeats', () => {
  it('counts members plus pending, unexpired invitations only', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const db = fakeDb({
      profiles: [{ id: 'p1' }, { id: 'p2' }],
      account_invitations: [
        { id: 'i1', accepted_at: null, expires_at: future },
        { id: 'i2', accepted_at: null, expires_at: past },
        { id: 'i3', accepted_at: new Date().toISOString(), expires_at: future },
      ],
    });

    await expect(countTeamSeats(db, 'acct')).resolves.toBe(3); // 2 members + 1 pending
  });
});

describe('countAiAgents', () => {
  it('counts config rows', async () => {
    const db = fakeDb({ ai_configs: [{ id: 'a1' }] });
    await expect(countAiAgents(db, 'acct')).resolves.toBe(1);
  });
});

describe('countBroadcastMessagesThisMonth', () => {
  it('sums recipients of this calendar month only', async () => {
    const now = new Date('2026-10-27T12:00:00Z');
    const db = fakeDb({
      profiles: [{ id: 'u1' }],
      broadcasts: [
        { total_recipients: 500, created_at: '2026-10-02T00:00:00Z', user_id: 'u1' },
        { total_recipients: 700, created_at: '2026-09-30T23:00:00Z', user_id: 'u1' },
      ],
    });

    await expect(
      countBroadcastMessagesThisMonth(db, 'acct', now)
    ).resolves.toBe(500);
  });

  it('is zero when the account has no members', async () => {
    await expect(
      countBroadcastMessagesThisMonth(fakeDb({}), 'acct')
    ).resolves.toBe(0);
  });
});
