import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getWhatsAppConfigs,
  getDefaultWhatsAppConfig,
  getWhatsAppConfigById,
  pickDefaultConfig,
  resolveWhatsAppConfigForConversation,
  type WhatsAppConfigRow,
} from './config-resolver';

function row(over: Partial<WhatsAppConfigRow>): WhatsAppConfigRow {
  return {
    id: 'cfg-1',
    account_id: 'acct-1',
    phone_number_id: '100000000001',
    waba_id: '200000000001',
    access_token: 'enc',
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

/**
 * PostgREST semantics, minimal: `.single()` errors PGRST116 on zero or
 * many rows, and the bare builder resolves to an array.
 */
function db(rows: WhatsAppConfigRow[], conversations: Record<string, unknown> = {}) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        single: () =>
          Promise.resolve(
            rows.length === 1
              ? { data: rows[0], error: null }
              : {
                  data: null,
                  error: { code: 'PGRST116', message: 'multiple or no rows' },
                },
          ),
        maybeSingle: () =>
          Promise.resolve(
            table === 'conversations'
              ? {
                  data: conversations.conversation ?? null,
                  error: null,
                }
              : { data: rows[0] ?? null, error: null },
          ),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('pickDefaultConfig', () => {
  it('prefers the flagged row, then the oldest', () => {
    const older = row({ id: 'a', created_at: '2026-01-01T00:00:00Z' });
    const newer = row({ id: 'b', created_at: '2026-02-01T00:00:00Z' });
    expect(pickDefaultConfig([newer, older])?.id).toBe('a');
    expect(
      pickDefaultConfig([newer, { ...older, is_default: true }])?.id,
    ).toBe('a');
    expect(pickDefaultConfig([{ ...newer, is_default: true }, older])?.id).toBe(
      'b',
    );
    expect(pickDefaultConfig([])).toBeNull();
  });
});

describe('getWhatsAppConfigs', () => {
  it('returns the single row an account has today', async () => {
    const rows = await getWhatsAppConfigs(db([row({})]), 'acct-1');
    expect(rows).toHaveLength(1);
  });

  it('returns every number when the account has several', async () => {
    const rows = await getWhatsAppConfigs(
      db([
        row({ id: 'a', created_at: '2026-01-01T00:00:00Z' }),
        row({
          id: 'b',
          phone_number_id: '100000000002',
          is_default: true,
          created_at: '2026-02-01T00:00:00Z',
        }),
      ]),
      'acct-1',
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(await getDefaultWhatsAppConfig(db(rows), 'acct-1')).toMatchObject({
      id: 'b',
    });
  });

  it('never throws when the account has nothing', async () => {
    await expect(getWhatsAppConfigs(db([]), 'acct-1')).resolves.toEqual([]);
    await expect(getDefaultWhatsAppConfig(db([]), 'acct-1')).resolves.toBeNull();
  });
});

describe('getWhatsAppConfigById', () => {
  it('finds one number and rejects a foreign id', async () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect((await getWhatsAppConfigById(db(rows), 'acct-1', 'b'))?.id).toBe('b');
    expect(await getWhatsAppConfigById(db(rows), 'acct-1', 'zzz')).toBeNull();
  });
});

describe('resolveWhatsAppConfigForConversation', () => {
  it('uses the conversation number when it has one', async () => {
    const rows = [
      row({ id: 'default', is_default: true }),
      row({ id: 'second', phone_number_id: '100000000002' }),
    ];
    const found = await resolveWhatsAppConfigForConversation(
      db(rows, { conversation: { whatsapp_config_id: 'second' } }),
      'acct-1',
      'conv-1',
    );
    expect(found?.id).toBe('second');
  });

  it('falls back to the default for legacy threads and deleted numbers', async () => {
    const rows = [row({ id: 'default', is_default: true })];
    expect(
      (
        await resolveWhatsAppConfigForConversation(
          db(rows, { conversation: { whatsapp_config_id: null } }),
          'acct-1',
          'conv-1',
        )
      )?.id,
    ).toBe('default');
    expect(
      (
        await resolveWhatsAppConfigForConversation(
          db(rows, { conversation: { whatsapp_config_id: 'gone' } }),
          'acct-1',
          'conv-1',
        )
      )?.id,
    ).toBe('default');
  });

  it('survives a broken conversation read', async () => {
    const broken = {
      from: () => {
        throw new Error('boom');
      },
    } as unknown as SupabaseClient;
    expect(
      await resolveWhatsAppConfigForConversation(broken, 'acct-1', 'conv-1'),
    ).toBeNull();
  });
});

describe('noisy client', () => {
  it('logs instead of throwing when the DB errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          single: () => Promise.reject(new Error('offline')),
          maybeSingle: () => Promise.reject(new Error('offline')),
          then: (_r: unknown, reject: (e: unknown) => unknown) =>
            reject(new Error('offline')),
        };
      },
    } as unknown as SupabaseClient;
    await expect(getWhatsAppConfigs(broken, 'acct-1')).resolves.toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
