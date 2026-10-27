/**
 * Persist parsed Messenger / Instagram inbound events.
 *
 * This is the non-WhatsApp twin of the WhatsApp branch in
 * `src/app/api/webhooks/meta/route.ts`. It deliberately reuses the
 * same invariants so a Messenger thread behaves exactly like a WhatsApp
 * one in the inbox:
 *
 *  - contacts are keyed by (account, channel, channel_user_id) and share
 *    the account's contact book;
 *  - one conversation per (account, contact) — the unique index from
 *    migration 036 still governs, so the find-or-create resolves to the
 *    oldest row and never forks on a Meta retry;
 *  - inbound media is mirrored into `chat-media` so it outlives Meta's
 *    CDN URL;
 *  - the conversation summary + unread counter are updated through the
 *    same DB-side RPC (migration 037) that WhatsApp uses, so concurrent
 *    deliveries cannot lose an increment.
 *
 * Everything here is best-effort per event: one bad event must not abort
 * the rest of the batch, and the route has already acked Meta by the time
 * this runs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { buildMediaPath } from '@/lib/storage/upload-media';
import { MIRROR_BUCKET } from '@/lib/whatsapp/mirror-inbound-media';

import {
  contentTypeForAttachment,
  parseMessagingWebhook,
  type InboundAttachment,
  type MessagingInboundEvent,
  type RawMessagingWebhook,
} from './inbound';
import { fetchChannelProfile } from './graph-api';
import type { MessagingChannel } from './types';

interface ChannelConfigRow {
  id: string;
  account_id: string;
  channel: MessagingChannel;
  external_id: string;
  access_token: string;
  is_active: boolean;
}

/** 16 MB, matching the chat-media bucket's object ceiling. */
const MAX_MIRROR_BYTES = 16 * 1024 * 1024;

export interface ProcessMessagingResult {
  processed: number;
  skipped: number;
}

export async function processMessagingWebhook(
  body: RawMessagingWebhook,
): Promise<ProcessMessagingResult> {
  const events = parseMessagingWebhook(body);
  if (events.length === 0) return { processed: 0, skipped: 0 };

  const db = supabaseAdmin();

  // Group by receiving account id so the config (and its token) is read
  // once per Page / IG account rather than per message.
  const groups = new Map<string, MessagingInboundEvent[]>();
  for (const event of events) {
    const key = `${event.channel}:${event.externalId}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(event);
    else groups.set(key, [event]);
  }

  let processed = 0;
  let skipped = 0;

  for (const group of groups.values()) {
    const first = group[0];
    const config = await loadConfig(db, first.channel, first.externalId);
    if (!config) {
      console.warn(
        `[channels] no active ${first.channel} config for external id ${first.externalId}; dropping ${group.length} event(s)`,
      );
      skipped += group.length;
      continue;
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch (err) {
      console.error(
        `[channels] cannot decrypt ${first.channel} token for account ${config.account_id}:`,
        err instanceof Error ? err.message : err,
      );
      skipped += group.length;
      continue;
    }

    // Self-heal legacy CBC ciphertexts, exactly like the WhatsApp send path.
    if (isLegacyFormat(config.access_token)) {
      void db
        .from('channel_configs')
        .update({ access_token: encrypt(accessToken) })
        .eq('id', config.id)
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) {
            console.warn('[channels] token GCM upgrade failed:', error.message);
          }
        });
    }

    for (const event of group) {
      try {
        const stored = await persistEvent(db, config, accessToken, event);
        if (stored) processed += 1;
        else skipped += 1;
      } catch (err) {
        skipped += 1;
        console.error('[channels] failed to persist inbound event:', {
          channel: event.channel,
          messageId: event.messageId,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }

  return { processed, skipped };
}

async function loadConfig(
  db: SupabaseClient,
  channel: MessagingChannel,
  externalId: string,
): Promise<ChannelConfigRow | null> {
  const { data, error } = await db
    .from('channel_configs')
    .select('id, account_id, channel, external_id, access_token, is_active')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[channels] config lookup failed:', error.message);
    return null;
  }
  return (data as ChannelConfigRow | null) ?? null;
}

async function persistEvent(
  db: SupabaseClient,
  config: ChannelConfigRow,
  accessToken: string,
  event: MessagingInboundEvent,
): Promise<boolean> {
  const accountId = config.account_id;

  // Idempotency: Meta retries a delivery when it does not see a fast 2xx.
  // Without this check every retry would duplicate the message body.
  if (event.messageId && (await messageExists(db, event.messageId))) {
    console.info(
      '[channels] duplicate inbound ignored (idempotent replay):',
      event.messageId,
    );
    return false;
  }

  const auditUserId = await resolveAuditUserId(db, accountId);

  const contact = await findOrCreateContact(db, {
    accountId,
    auditUserId,
    channel: event.channel,
    senderId: event.senderId,
    accessToken,
    externalId: config.external_id,
    // NOT the message body: that is what printed a customer's first line as
    // their contact name. The poll supplies the real participant name; the
    // webhook path falls back to the profile lookup or the PSID.
    fallbackName: event.senderName ?? null,
  });
  if (!contact) return false;

  const conversationId = await findOrCreateConversation(
    db,
    accountId,
    auditUserId,
    contact.id,
    event.channel,
  );
  if (!conversationId) return false;

  const primary = event.attachments[0] ?? null;
  const mediaUrl = primary?.url
    ? await mirrorRemoteMedia(db, accountId, primary)
    : null;

  // The message's own timestamp, not the insert time: the Graph poller
  // backfills history, and a `now()` default would both corrupt the thread
  // order and make old conversations jump to the top of the inbox.
  const eventAt = Number.isFinite(Date.parse(event.createdAt))
    ? new Date(event.createdAt).toISOString()
    : new Date().toISOString();

  const { error: insertError } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: primary ? contentTypeForAttachment(primary.type) : 'text',
    content_text: event.text,
    media_url: mediaUrl,
    message_id: event.messageId,
    status: 'delivered',
    created_at: eventAt,
  });

  if (insertError) {
    console.error('[channels] message insert failed:', insertError.message);
    return false;
  }

  const preview =
    event.text ||
    (primary ? `[${contentTypeForAttachment(primary.type)}]` : '[message]');

  // Same DB-side bump the WhatsApp path uses — one statement, so two
  // concurrent inbounds cannot lose the unread increment.
  // Only the newest message may move `last_message_at` and raise the unread
  // badge. A backfilled older message still lands in the thread, in order.
  const { data: convRow } = await db
    .from('conversations')
    .select('last_message_at')
    .eq('id', conversationId)
    .maybeSingle();
  const lastAt = convRow?.last_message_at
    ? Date.parse(convRow.last_message_at as string)
    : 0;
  const isNewest = Date.parse(eventAt) >= (Number.isFinite(lastAt) ? lastAt : 0);

  const { error: bumpError } = await db.rpc('bump_conversation_on_inbound_at', {
    p_conversation_id: conversationId,
    p_last_message_text: preview,
    p_at: eventAt,
    p_count_unread: isNewest,
  });
  if (bumpError) {
    console.error('[channels] conversation bump failed:', bumpError.message);
  }

  // A customer writing again re-opens a closed thread (issue #409).
  await db
    .from('conversations')
    .update({ status: 'open', closed_at: null })
    .eq('id', conversationId)
    .eq('status', 'closed');

  return true;
}

async function messageExists(
  db: SupabaseClient,
  messageId: string,
): Promise<boolean> {
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('message_id', messageId)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function findOrCreateContact(
  db: SupabaseClient,
  args: {
    accountId: string;
    auditUserId: string;
    channel: MessagingChannel;
    senderId: string;
    accessToken: string;
    externalId: string;
    fallbackName: string | null;
  },
): Promise<{ id: string } | null> {
  const { accountId, channel, senderId } = args;

  const { data: existing } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('channel', channel)
    .eq('channel_user_id', senderId)
    .maybeSingle();

  if (existing) return existing as { id: string };

  // A channel user has no phone number, so `phone` stays '' — migration
  // 022's partial unique index ignores blank numbers, which is exactly
  // what the WhatsApp BSUID-only path relies on too.
  const profile = await fetchChannelProfile(channel, {
    externalId: args.externalId,
    accessToken: args.accessToken,
    userId: senderId,
  });

  const name =
    profile?.name ||
    (profile?.username ? `@${profile.username}` : null) ||
    args.fallbackName ||
    senderId;

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: args.auditUserId,
      phone: '',
      name,
      avatar_url: profile?.avatarUrl ?? null,
      channel,
      channel_user_id: senderId,
    })
    .select('id')
    .single();

  if (error) {
    // Lost a race against a concurrent delivery for the same person —
    // the unique index (migration 060) rejected the duplicate. Re-read.
    const { data: raced } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('channel', channel)
      .eq('channel_user_id', senderId)
      .maybeSingle();
    if (raced) return raced as { id: string };
    console.error('[channels] contact create failed:', error.message);
    return null;
  }

  return created as { id: string };
}

async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
  channel: MessagingChannel,
): Promise<string | null> {
  // Oldest-first rather than `.single()`: `.single()` errors on ≥2 rows
  // too, and treating that error as "none found" is what snowballed into
  // duplicate threads in issue #363.
  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (existing && existing.length > 0) {
    return (existing[0] as { id: string }).id;
  }

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      contact_id: contactId,
      channel,
    })
    .select('id')
    .single();

  if (error) {
    const { data: raced } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1);
    if (raced && raced.length > 0) return (raced[0] as { id: string }).id;
    console.error('[channels] conversation create failed:', error.message);
    return null;
  }

  return (created as { id: string }).id;
}

/**
 * Copy an inbound attachment into `chat-media` and return its public URL.
 *
 * Meta's CDN URLs are short-lived and require the token to re-fetch, so a
 * thread that pointed at them directly would rot within days. On any
 * failure return the original URL: a link that works for now beats no
 * attachment at all, and the webhook must never throw here.
 */
async function mirrorRemoteMedia(
  db: SupabaseClient,
  accountId: string,
  attachment: InboundAttachment,
): Promise<string | null> {
  const remote = attachment.url;
  if (!remote) return null;

  try {
    const res = await fetch(remote, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return remote;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MIRROR_BYTES) return remote;

    const mime =
      res.headers.get('content-type')?.split(';')[0]?.trim() ||
      (attachment.type === 'image'
        ? 'image/jpeg'
        : attachment.type === 'video'
          ? 'video/mp4'
          : attachment.type === 'audio'
            ? 'audio/mpeg'
            : 'application/octet-stream');

    const ext =
      attachment.type === 'image'
        ? 'jpg'
        : attachment.type === 'video'
          ? 'mp4'
          : attachment.type === 'audio'
            ? 'mp3'
            : 'bin';

    const path = buildMediaPath(accountId, `inbound-${Date.now()}.${ext}`, null, 'inbound');

    const { error } = await db.storage
      .from(MIRROR_BUCKET)
      .upload(path, bytes, {
        contentType: mime,
        cacheControl: '31536000',
        upsert: false,
      });

    if (error) {
      console.warn('[channels] media mirror failed:', error.message);
      return remote;
    }

    const { data } = db.storage.from(MIRROR_BUCKET).getPublicUrl(path);
    return data.publicUrl || remote;
  } catch (err) {
    console.warn(
      '[channels] media mirror threw:',
      err instanceof Error ? err.message : err,
    );
    return remote;
  }
}
