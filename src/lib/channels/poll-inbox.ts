/**
 * Pull-based fallback for channels whose webhooks Meta will not deliver yet.
 *
 * `POST /api/webhooks/meta` only receives Page/Instagram events for people who
 * hold a role on the Meta app while it is in Development Mode. A customer who
 * is not an admin/tester can still *write* to their Page — the message reaches
 * the Page inbox — but Meta never calls us, so the thread stays invisible in
 * ExBolt until App Review grants advanced access.
 *
 * This module closes that gap the other way round: on a schedule we ask Graph
 * for the newest conversations of every active Page/IG channel and feed them
 * into the exact same persistence path the webhook uses
 * (`processMessagingWebhook`). `message_id` de-duplication inside that path
 * makes the poll idempotent, so running it while real webhooks are also
 * arriving cannot create a second copy of a message.
 *
 * It is a fallback, not a replacement: latency is the poll interval, and it
 * costs Graph quota. Disable it once the app is live.
 */

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

import { graphUrl } from './graph-api';
import type { RawMessagingWebhook } from './inbound';
import { processMessagingWebhook } from './process-inbound';
import type { MessagingChannel } from './types';

export interface GraphAttachmentData {
  mime_type?: string;
  name?: string;
  url?: string;
  image_data?: { url?: string };
  video_data?: { url?: string };
  audio_data?: { url?: string };
  file_url?: string;
}

export interface GraphMessage {
  id?: string;
  created_time?: string;
  from?: { id?: string; name?: string };
  message?: string;
  attachments?: { data?: GraphAttachmentData[] };
}

export interface GraphConversation {
  id?: string;
  updated_time?: string;
  participants?: { data?: { id?: string; name?: string; username?: string }[] };
  messages?: { data?: GraphMessage[] };
}

const OBJECT_FOR_CHANNEL: Record<MessagingChannel, string> = {
  messenger: 'page',
  instagram: 'instagram',
};

/** Best URL + Meta attachment type for one Graph attachment entry. */
function attachmentOf(
  data: GraphAttachmentData
): { type: string; url: string } | null {
  if (data.image_data?.url) return { type: 'image', url: data.image_data.url };
  if (data.video_data?.url) return { type: 'video', url: data.video_data.url };
  if (data.audio_data?.url) return { type: 'audio', url: data.audio_data.url };
  if (data.file_url) return { type: 'file', url: data.file_url };

  const mime = data.mime_type ?? '';
  if (mime.startsWith('image/') && data.url) return { type: 'image', url: data.url };
  if (mime.startsWith('video/') && data.url) return { type: 'video', url: data.url };
  if (mime.startsWith('audio/') && data.url) return { type: 'audio', url: data.url };
  return null;
}

/**
 * Shape Graph conversations into the Messenger/Instagram webhook body
 * `processMessagingWebhook` already understands.
 *
 * Dropped on purpose:
 *  - messages sent by the channel itself (`from.id === externalId`) — they are
 *    already rows written by the send path, and echoing them would duplicate
 *    every reply;
 *  - messages with no id (cannot be de-duplicated) or no text/attachment.
 */
export function graphConversationsToWebhook(args: {
  channel: MessagingChannel;
  externalId: string;
  conversations: GraphConversation[];
}): RawMessagingWebhook | null {
  const { channel, externalId, conversations } = args;
  const messaging: Record<string, unknown>[] = [];

  for (const conversation of conversations) {
    // The conversations edge carries each participant's name; the user-profile
    // endpoint needs permissions this app does not have yet, so this is the
    // only cheap source of a real display name.
    const participants = conversation.participants?.data ?? [];
    const nameFor = (id: string) => {
      const p = participants.find((x) => x.id === id);
      return p?.name?.trim() || (p?.username ? `@${p.username}` : null);
    };

    for (const message of conversation.messages?.data ?? []) {
      const senderId = message.from?.id;
      if (!senderId || senderId === externalId) continue;
      if (!message.id) continue;

      const attachments = (message.attachments?.data ?? [])
        .map(attachmentOf)
        .filter((a): a is { type: string; url: string } => a !== null)
        .map((a) => ({ type: a.type, payload: { url: a.url } }));

      const text = message.message?.trim() || null;
      if (!text && attachments.length === 0) continue;

      const created = message.created_time ? Date.parse(message.created_time) : NaN;

      messaging.push({
        sender: { id: senderId, name: nameFor(senderId) ?? undefined },
        recipient: { id: externalId },
        timestamp: Number.isFinite(created) ? created : Date.now(),
        message: {
          mid: message.id,
          text: text ?? undefined,
          is_echo: false,
          attachments,
        },
      });
    }
  }

  if (messaging.length === 0) return null;

  return {
    object: OBJECT_FOR_CHANNEL[channel],
    entry: [{ id: externalId, time: Date.now(), messaging }],
  };
}

interface PollConfigRow {
  id: string;
  account_id: string;
  channel: MessagingChannel;
  external_id: string;
  access_token: string;
  last_error: string | null;
}

/**
 * A channel whose Graph edge keeps failing (Instagram returned HTTP 500 after
 * 30s for a healthy-looking account) must not eat the poll budget every tick,
 * or the 10-second cadence collapses. Failures are stamped into `last_error`
 * and the config is skipped for 15 minutes; a success clears the stamp.
 */
const POLL_ERROR_PREFIX = 'poll:';
const POLL_BREAKER_MS = 15 * 60 * 1000;

function isCoolingDown(lastError: string | null): boolean {
  if (!lastError?.startsWith(POLL_ERROR_PREFIX)) return false;
  const at = Date.parse(lastError.slice(POLL_ERROR_PREFIX.length, POLL_ERROR_PREFIX.length + 24));
  return Number.isFinite(at) && Date.now() - at < POLL_BREAKER_MS;
}

function pollError(message: string): string {
  return `${POLL_ERROR_PREFIX}${new Date().toISOString()}: ${message}`.slice(0, 300);
}

export interface PollInboxResult {
  configs: number;
  conversations: number;
  messages: number;
  processed: number;
  skipped: number;
  errors: string[];
}

const DEFAULT_CONVERSATIONS_PER_CONFIG = 8;
const DEFAULT_MESSAGES_PER_CONVERSATION = 5;

/**
 * Poll every active Messenger/Instagram channel once.
 *
 * Bounded on purpose: newest N conversations, newest M messages each. The
 * schedule (every 2 minutes) plus message-id de-duplication converges on the
 * same inbox a webhook would have produced.
 */
export async function pollMessagingInbox(opts?: {
  conversationsPerConfig?: number;
  messagesPerConversation?: number;
  fetchImpl?: typeof fetch;
}): Promise<PollInboxResult> {
  const perConfig = opts?.conversationsPerConfig ?? DEFAULT_CONVERSATIONS_PER_CONFIG;
  const perConversation =
    opts?.messagesPerConversation ?? DEFAULT_MESSAGES_PER_CONVERSATION;
  const doFetch = opts?.fetchImpl ?? fetch;

  const db = supabaseAdmin();
  const result: PollInboxResult = {
    configs: 0,
    conversations: 0,
    messages: 0,
    processed: 0,
    skipped: 0,
    errors: [],
  };

  const { data, error } = await db
    .from('channel_configs')
    .select('id, account_id, channel, external_id, access_token, last_error')
    .eq('is_active', true)
    .in('channel', ['messenger', 'instagram']);

  if (error) {
    result.errors.push(`load configs: ${error.message}`);
    return result;
  }

  for (const row of (data ?? []) as PollConfigRow[]) {
    if (isCoolingDown(row.last_error)) {
      result.skipped = (result.skipped ?? 0) + 1;
      continue;
    }
    result.configs += 1;

    let token: string;
    try {
      token = decrypt(row.access_token);
    } catch (err) {
      const message = `token decrypt failed: ${
        err instanceof Error ? err.message : 'unknown'
      }`;
      result.errors.push(`${row.channel}:${row.external_id} ${message}`);
      await db
        .from('channel_configs')
        .update({ last_error: pollError(message) })
        .eq('id', row.id);
      continue;
    }

    const url = new URL(graphUrl(`${row.external_id}/conversations`));
    url.searchParams.set(
      'fields',
      `updated_time,participants,messages.limit(${perConversation}){id,created_time,from,message,attachments}`
    );
    url.searchParams.set('limit', String(perConfig));
    url.searchParams.set('access_token', token);

    let conversations: GraphConversation[] = [];
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(6000) });
      const payload = (await res.json().catch(() => ({}))) as {
        data?: GraphConversation[];
        error?: { message?: string };
      };
      if (!res.ok) {
        const message = `graph ${res.status}: ${payload.error?.message ?? 'unknown error'}`;
        result.errors.push(`${row.channel}:${row.external_id} ${message}`);
        await db
          .from('channel_configs')
          .update({ last_error: pollError(message) })
          .eq('id', row.id);
        continue;
      }
      conversations = payload.data ?? [];
    } catch (err) {
      const message = `fetch failed: ${err instanceof Error ? err.message : 'unknown'}`;
      result.errors.push(`${row.channel}:${row.external_id} ${message}`);
      await db
        .from('channel_configs')
        .update({ last_error: pollError(message) })
        .eq('id', row.id);
      continue;
    }

    result.conversations += conversations.length;

    // The call succeeded — clear a breaker stamp left by an earlier failure.
    if (row.last_error?.startsWith(POLL_ERROR_PREFIX)) {
      await db.from('channel_configs').update({ last_error: null }).eq('id', row.id);
    }

    const body = graphConversationsToWebhook({
      channel: row.channel,
      externalId: row.external_id,
      conversations,
    });
    if (!body) continue;

    result.messages += body.entry?.[0]?.messaging?.length ?? 0;

    try {
      const processed = await processMessagingWebhook(body);
      result.processed += processed.processed;
    } catch (err) {
      result.errors.push(
        `${row.channel}:${row.external_id} persist failed: ${
          err instanceof Error ? err.message : 'unknown'
        }`
      );
    }
  }

  return result;
}
