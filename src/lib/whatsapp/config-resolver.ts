// ============================================================
// WhatsApp number resolution (multi-number, phase 1).
//
// Until migration 076 an account has exactly one whatsapp_config
// row; afterwards it can have several (GROWTH+ sells the slots).
// Every reader must therefore stop assuming `.single()` and ask one
// of these helpers instead:
//
//   getWhatsAppConfigs(db, accountId)            → all rows
//   getDefaultWhatsAppConfig(db, accountId)      → the flagged row
//   getWhatsAppConfigById(db, accountId, id)     → one row
//   resolveWhatsAppConfigForConversation(...)    → the thread's number
//
// Read strategy: try the single-row fast path first (that is what the
// vast majority of accounts still are, and it is the pre-075 query
// shape), and only pay for a list read when PostgREST answers
// PGRST116 — "multiple rows". Costs one extra round-trip for a
// multi-number account and nothing for everybody else.
//
// Rules that keep this safe while the constraint still exists:
//   • reads NEVER throw on zero rows — they return null / [] and the
//     caller raises its own domain error (SendMessageError, …);
//   • with one row, the default resolver returns it, so behaviour is
//     identical to the old `.single()` path;
//   • with many rows and none flagged, the oldest row wins — never
//     `undefined`, never a crash.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** The columns the send path needs; `select('*')` returns more. */
export interface WhatsAppConfigRow {
  id: string;
  account_id: string;
  phone_number_id: string;
  waba_id: string | null;
  access_token: string;
  verify_token?: string | null;
  status?: string | null;
  is_default?: boolean | null;
  registered_at?: string | null;
  connected_at?: string | null;
  mirror_inbound_media?: boolean | null;
  /** Human number, e.g. 201068910995 (migration 077). */
  display_phone_number?: string | null;
  /** Meta-verified business name for this number. */
  verified_name?: string | null;
  last_error?: string | null;
  last_registration_error?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

/**
 * Pick the default row out of a set.
 *
 * Preference order: the row flagged `is_default`, then the oldest
 * (`created_at`, then `id` so the choice is deterministic even when
 * the timestamps tie — rows created in the same transaction do).
 */
export function pickDefaultConfig<T extends WhatsAppConfigRow>(
  rows: readonly T[],
): T | null {
  if (rows.length === 0) return null;
  const flagged = rows.find((row) => row.is_default === true);
  if (flagged) return flagged;
  return [...rows].sort((a, b) => {
    const at = a.created_at ?? '';
    const bt = b.created_at ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

function byCreatedAt<T extends WhatsAppConfigRow>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    const at = a.created_at ?? '';
    const bt = b.created_at ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Read every number of an account. Never throws.
 *
 * The list read is attempted directly (PostgREST returns an array);
 * a DB error is logged and reported as "no numbers" so callers keep
 * their own domain error instead of a 500.
 */
export async function getWhatsAppConfigs(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsAppConfigRow[]> {
  // Fast path: exactly one row — the shape every account had before
  // migration 076.
  try {
    const single = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single();
    if (!single.error && single.data) {
      return [single.data as WhatsAppConfigRow];
    }
  } catch (err) {
    // PostgREST answers PGRST116, never a throw; a throw here is a
    // broken client. Fall through to the list read.
    console.error('[config-resolver] single read threw:', err);
  }

  try {
    const { data, error } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId);
    if (error) {
      console.error('[config-resolver] list errored:', error.message);
    } else if (data) {
      const rows = (Array.isArray(data) ? data : [data]) as WhatsAppConfigRow[];
      if (rows.length > 0) return byCreatedAt(rows);
    }
  } catch (err) {
    console.error('[config-resolver] list read threw:', err);
  }

  // Last resort: a client/test double that only implements
  // `.maybeSingle()` (the pre-075 read shape).
  try {
    const { data, error } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (!error && data) return [data as WhatsAppConfigRow];
  } catch {
    // nothing left to try
  }

  return [];
}

/** The number a send without an explicit choice uses. Null when none. */
export async function getDefaultWhatsAppConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsAppConfigRow | null> {
  return pickDefaultConfig(await getWhatsAppConfigs(db, accountId));
}

/** One number by id, account-scoped. Null when missing / foreign. */
export async function getWhatsAppConfigById(
  db: SupabaseClient,
  accountId: string,
  configId: string,
): Promise<WhatsAppConfigRow | null> {
  const rows = await getWhatsAppConfigs(db, accountId);
  return rows.find((row) => row.id === configId) ?? null;
}

/**
 * The number a conversation's replies must leave from.
 *
 * Order: the conversation's own `whatsapp_config_id` (set on create
 * since migration 075), then the account default. A thread created
 * before the backfill, or whose number was deleted, falls back to the
 * default instead of failing the send.
 */
export async function resolveWhatsAppConfigForConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string | null | undefined,
): Promise<WhatsAppConfigRow | null> {
  if (conversationId) {
    try {
      const { data, error } = await db
        .from('conversations')
        .select('whatsapp_config_id')
        .eq('id', conversationId)
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) {
        console.error(
          '[config-resolver] conversation lookup errored:',
          error.message,
        );
      }

      const configId = (data as { whatsapp_config_id?: string | null } | null)
        ?.whatsapp_config_id;
      if (configId) {
        const rows = await getWhatsAppConfigs(db, accountId);
        const own = rows.find((row) => row.id === configId);
        if (own) return own;
      }
    } catch (err) {
      console.error('[config-resolver] conversation read threw:', err);
    }
  }
  return getDefaultWhatsAppConfig(db, accountId);
}
