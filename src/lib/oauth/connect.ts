/**
 * Server-side write half of the Meta OAuth flow.
 *
 * `src/lib/oauth/meta.ts` stays pure (URLs, signing, Graph reads, mapping);
 * this module owns the parts that touch the database and the side effects a
 * connection implies (webhook subscription). Both the callback route and the
 * multi-Page chooser POST go through here, so a channel is written exactly
 * one way whether it was the only Page or the one picked from a list.
 */

import { supabaseAdmin } from '@/lib/automations/admin-client';
import type { MessagingChannel } from '@/lib/channels/types';
import { graphUrl, subscribePageToApp } from '@/lib/channels/graph-api';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  listWabaPhoneNumbers,
  subscribeWabaToApp,
} from '@/lib/whatsapp/meta-api';

import { buildChannelConfigRow, type MetaPage } from './meta';

export type ConnectPageResult =
  | {
      ok: true;
      channel: MessagingChannel;
      externalId: string;
      displayName: string | null;
      subscribed: boolean;
      subscribeError: string | null;
    }
  | {
      ok: false;
      reason:
        | 'instagram_account_missing'
        | 'page_token_missing'
        | 'linked_elsewhere'
        | 'db_error';
      message: string;
    };

/**
 * Store a Page (Messenger) or its linked IG business account (Instagram) as
 * the account's connection for `channel`.
 *
 * The Page is subscribed to this app's webhook first — with the *Page* token
 * and the *Page* id, which is what covers both the `page` and `instagram`
 * webhook objects. A subscription failure is reported but does not abort the
 * save: the credentials are valid and the Settings screen already surfaces
 * "connected but not receiving" separately.
 */
export async function connectMessagingChannel(args: {
  accountId: string;
  channel: MessagingChannel;
  page: MetaPage;
}): Promise<ConnectPageResult> {
  const { accountId, channel, page } = args;

  const mapped = buildChannelConfigRow({ channel, page, encrypt });
  if (!mapped.ok) {
    return {
      ok: false,
      reason: mapped.reason,
      message:
        mapped.reason === 'instagram_account_missing'
          ? 'This Facebook Page has no linked Instagram business account.'
          : 'Meta returned no Page access token for this Page.',
    };
  }

  const db = supabaseAdmin();

  // (channel, external_id) is unique across the whole install: two accounts
  // pointing at the same Page would both pass RLS but only one can receive
  // the webhook. Check before writing so the user gets a sentence, not a
  // raw unique-violation.
  const { data: claimed, error: claimedError } = await db
    .from('channel_configs')
    .select('account_id')
    .eq('channel', channel)
    .eq('external_id', mapped.row.external_id)
    .neq('account_id', accountId)
    .maybeSingle();

  if (claimedError) {
    console.error(
      '[oauth/meta] channel conflict check failed:',
      claimedError.message
    );
    return { ok: false, reason: 'db_error', message: claimedError.message };
  }
  if (claimed) {
    return {
      ok: false,
      reason: 'linked_elsewhere',
      message: 'Another account has already connected this Page.',
    };
  }

  const subscribed = await subscribePageToApp({
    externalId: page.id,
    accessToken: page.access_token,
  });

  const { error } = await db.from('channel_configs').upsert(
    {
      account_id: accountId,
      channel,
      external_id: mapped.row.external_id,
      display_name: mapped.row.display_name,
      access_token: mapped.row.access_token,
      is_active: true,
      last_error: subscribed.ok
        ? null
        : (subscribed.error ?? 'subscription failed'),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,channel' }
  );

  if (error) {
    console.error('[oauth/meta] channel_configs upsert failed:', error.message);
    return { ok: false, reason: 'db_error', message: error.message };
  }

  return {
    ok: true,
    channel,
    externalId: mapped.row.external_id,
    displayName: mapped.row.display_name,
    subscribed: subscribed.ok,
    subscribeError: subscribed.ok
      ? null
      : (subscribed.error ?? 'subscription failed'),
  };
}

export type ConnectWhatsAppResult =
  | {
      ok: true;
      phoneNumberId: string;
      wabaId: string;
      displayNumber: string | null;
      displayName: string | null;
      subscribed: boolean;
    }
  | {
      ok: false;
      reason: 'number_taken' | 'phone_not_found' | 'meta_error' | 'db_error';
      message: string;
    };

async function fetchWabaName(
  wabaId: string,
  accessToken: string
): Promise<string | null> {
  try {
    const url = new URL(graphUrl(wabaId));
    url.searchParams.set('fields', 'name');
    url.searchParams.set('access_token', accessToken);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => ({}))) as { name?: string };
    return payload.name ?? null;
  } catch {
    // Cosmetic only — the number + WABA ids are what the inbox needs.
    return null;
  }
}

/**
 * Write `whatsapp_config` from an Embedded Signup callback.
 *
 * Unlike the manual POST, this path does not call `/register` (it needs a
 * 2FA PIN the customer may not have) and it preserves whatever
 * `verify_token` the account already had — the upsert only supplies the
 * columns listed below, so an existing webhook verify token keeps working.
 */
export async function connectWhatsAppNumber(args: {
  accountId: string;
  userId: string;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<ConnectWhatsAppResult> {
  const { accountId, userId, wabaId, phoneNumberId, accessToken } = args;
  const db = supabaseAdmin();

  const { data: claimed, error: claimedError } = await db
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', accountId)
    .maybeSingle();

  if (claimedError) {
    console.error(
      '[oauth/meta] whatsapp ownership check failed:',
      claimedError.message
    );
    return { ok: false, reason: 'db_error', message: claimedError.message };
  }
  if (claimed) {
    return {
      ok: false,
      reason: 'number_taken',
      message: 'Another account has already connected this WhatsApp number.',
    };
  }

  let numbers;
  try {
    numbers = await listWabaPhoneNumbers({ wabaId, accessToken });
  } catch (err) {
    return {
      ok: false,
      reason: 'meta_error',
      message:
        err instanceof Error ? err.message : 'Meta rejected the WABA lookup',
    };
  }

  const number = numbers.find((n) => n.id === phoneNumberId);
  if (!number) {
    return {
      ok: false,
      reason: 'phone_not_found',
      message:
        'The selected phone number is not listed under that WhatsApp Business account.',
    };
  }

  // Subscribe the WABA so inbound messages start flowing. Best effort: a
  // missing whatsapp_business_management grant should not throw away a
  // valid number, and GET /api/whatsapp/config reports the state anyway.
  let subscribed = false;
  try {
    await subscribeWabaToApp({ wabaId, accessToken });
    subscribed = true;
  } catch (err) {
    console.warn(
      '[oauth/meta] WABA subscription failed:',
      err instanceof Error ? err.message : 'unknown error'
    );
  }

  const wabaName = await fetchWabaName(wabaId, accessToken);
  const displayName = number.verified_name ?? wabaName ?? null;
  const now = new Date().toISOString();

  const { data: existing, error: existingError } = await db
    .from('whatsapp_config')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle();

  if (existingError) {
    console.error(
      '[oauth/meta] whatsapp_config read failed:',
      existingError.message
    );
    return { ok: false, reason: 'db_error', message: existingError.message };
  }

  const row = {
    phone_number_id: phoneNumberId,
    waba_id: wabaId,
    access_token: encrypt(accessToken),
    status: 'connected' as const,
    connected_at: now,
    subscribed_apps_at: subscribed ? now : null,
    updated_at: now,
  };

  if (existing) {
    const { error } = await db
      .from('whatsapp_config')
      .update(row)
      .eq('account_id', accountId);
    if (error) {
      console.error(
        '[oauth/meta] whatsapp_config update failed:',
        error.message
      );
      return { ok: false, reason: 'db_error', message: error.message };
    }
  } else {
    const { error } = await db
      .from('whatsapp_config')
      .insert({ account_id: accountId, user_id: userId, ...row });
    if (error) {
      console.error(
        '[oauth/meta] whatsapp_config insert failed:',
        error.message
      );
      return { ok: false, reason: 'db_error', message: error.message };
    }
  }

  return {
    ok: true,
    phoneNumberId,
    wabaId,
    displayNumber: number.display_phone_number ?? null,
    displayName,
    subscribed,
  };
}
