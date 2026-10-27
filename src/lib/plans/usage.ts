/**
 * Plan-limit usage counters.
 *
 * `requireWithinLimit()` (lib/plans/guard.ts) has existed since the plans
 * migration but was never called, so every numeric limit in `plans.limits`
 * (channels, team_members, ai_agents, broadcast_monthly) was decorative. These
 * counters are the single place that decides "what is in use right now", so the
 * server check and any UI hint cannot disagree.
 *
 * Every counter takes the account id and returns a number for the state BEFORE
 * the operation, which is what `withinLimit(current < limit)` expects.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** One WhatsApp row per number + one row per active messaging channel. */
export async function countActiveChannels(
  db: SupabaseClient,
  accountId: string
): Promise<number> {
  const [numbers, channels] = await Promise.all([
    db.from('whatsapp_config').select('id').eq('account_id', accountId),
    db
      .from('channel_configs')
      .select('id, is_active')
      .eq('account_id', accountId),
  ]);

  const numberRows = (numbers.data ?? []) as { id: string }[];
  const channelRows = (channels.data ?? []) as { id: string; is_active?: boolean }[];

  return (
    numberRows.length + channelRows.filter((row) => row.is_active !== false).length
  );
}

/**
 * Members that occupy a seat: everyone already in the account plus every
 * invitation that has not been used yet (a pending invite will become a seat).
 */
export async function countTeamSeats(
  db: SupabaseClient,
  accountId: string
): Promise<number> {
  const [members, invitations] = await Promise.all([
    db.from('profiles').select('id').eq('account_id', accountId),
    db
      .from('account_invitations')
      .select('id, accepted_at, expires_at')
      .eq('account_id', accountId),
  ]);

  const memberRows = (members.data ?? []) as { id: string }[];
  const inviteRows = (invitations.data ?? []) as {
    id: string;
    accepted_at?: string | null;
    expires_at?: string | null;
  }[];

  // A pending invite will become a seat, so it counts. Expired ones cannot be
  // accepted, so they must not block a new invitation.
  const now = Date.now();
  const pending = inviteRows.filter(
    (row) =>
      !row.accepted_at &&
      (!row.expires_at || Date.parse(row.expires_at) > now)
  ).length;

  return memberRows.length + pending;
}

/** `ai_configs` holds one row per agent (BYO key), so the count is the rows. */
export async function countAiAgents(
  db: SupabaseClient,
  accountId: string
): Promise<number> {
  const { data } = await db
    .from('ai_configs')
    .select('id')
    .eq('account_id', accountId);

  return ((data ?? []) as { id: string }[]).length;
}

/**
 * Broadcast volume for the current calendar month, in recipients.
 *
 * `broadcasts` is owned by a user, not directly by the account, so the account
 * is resolved through its members first. Bounded by the member list, which is
 * small (≤ 15 on GROWTH).
 */
export async function countBroadcastMessagesThisMonth(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date()
): Promise<number> {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();

  const { data: members } = await db
    .from('profiles')
    .select('id')
    .eq('account_id', accountId);

  const userIds = ((members ?? []) as { id: string }[]).map((m) => m.id);
  if (userIds.length === 0) return 0;

  const { data: broadcasts } = await db
    .from('broadcasts')
    .select('total_recipients, created_at, user_id')
    .in('user_id', userIds);

  const rows = (broadcasts ?? []) as {
    total_recipients?: number | null;
    created_at?: string | null;
  }[];

  return rows
    .filter((row) => (row.created_at ?? '') >= monthStart)
    .reduce((sum, row) => sum + (row.total_recipients ?? 0), 0);
}

export interface ChannelSlotState {
  /** This exact number / page is already on the account: it is an update. */
  connected: boolean;
  /** Everything occupying a slot right now (numbers + active channels). */
  used: number;
}

/**
 * Where a connect attempt stands against `limits.channels`.
 *
 * `externalId` is the phone number id (WhatsApp) or Page/IG id, so
 * *re-connecting the same asset* is treated as an update and never blocked —
 * only genuinely new assets ask for a free slot.
 */
export async function channelSlotState(
  db: SupabaseClient,
  accountId: string,
  channel: 'whatsapp' | 'messenger' | 'instagram',
  externalId?: string | null
): Promise<ChannelSlotState> {
  const [numbers, channels] = await Promise.all([
    db
      .from('whatsapp_config')
      .select('id, phone_number_id')
      .eq('account_id', accountId),
    db
      .from('channel_configs')
      .select('id, channel, external_id, is_active')
      .eq('account_id', accountId),
  ]);

  const numberRows = (numbers.data ?? []) as {
    id: string;
    phone_number_id?: string | null;
  }[];
  const channelRows = (channels.data ?? []) as {
    id: string;
    channel?: string;
    external_id?: string | null;
    is_active?: boolean;
  }[];
  const active = channelRows.filter((row) => row.is_active !== false);

  const connected =
    channel === 'whatsapp'
      ? Boolean(
          externalId && numberRows.some((r) => r.phone_number_id === externalId)
        )
      : active.some(
          (r) =>
            r.channel === channel &&
            (!externalId || r.external_id === externalId)
        );

  return { connected, used: numberRows.length + active.length };
}
