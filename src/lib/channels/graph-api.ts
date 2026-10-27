/**
 * Meta Graph API surface for the messaging channels (Messenger +
 * Instagram DMs).
 *
 * Both channels speak the same Send API shape — `POST /{id}/messages`
 * with `recipient.id` — so one module serves both; only the id it posts
 * to differs (Facebook Page id vs Instagram business account id) and the
 * token is whichever Page token the account connected.
 *
 * Version pinning: Meta deprecates Graph versions on a ~2-year cycle, so
 * the version is configurable (`META_GRAPH_VERSION`) instead of baked in.
 * v23.0 is the default because that is the version the WhatsApp layer in
 * `src/lib/whatsapp/meta-api.ts` already targets.
 */

import type { MessagingChannel } from './types';

export const DEFAULT_GRAPH_VERSION = 'v23.0';

export function graphVersion(): string {
  return process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
}

export function graphUrl(path: string): string {
  return `https://graph.facebook.com/${graphVersion()}/${path.replace(/^\/+/, '')}`;
}

/** Media kinds the composer can send, mapped to Meta attachment types. */
export type ChannelMediaKind = 'image' | 'video' | 'audio' | 'document';

const ATTACHMENT_TYPE: Record<ChannelMediaKind, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'file',
};

export interface ChannelSendArgs {
  /** Page id (messenger) or IG business account id (instagram). */
  externalId: string;
  /** Decrypted Page access token. */
  accessToken: string;
  /** PSID (messenger) or IGSID (instagram) of the recipient. */
  recipientId: string;
  /** Meta message id (`message_id`) of the message being sent. */
  replyToMessageId?: string;
}

export class ChannelGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'ChannelGraphError';
  }
}

async function postMessage(
  args: Pick<ChannelSendArgs, 'externalId' | 'accessToken' | 'recipientId'>,
  message: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(graphUrl(`${args.externalId}/messages`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: args.recipientId },
      // 'RESPONSE' is the only messaging_type allowed inside the 24h
      // standard window; outside it Meta requires a message tag or a
      // paid conversation, same constraint as WhatsApp's session.
      messaging_type: 'RESPONSE',
      message,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    message_id?: string;
    error?: { message?: string; code?: number };
  };

  if (!res.ok || payload.error) {
    throw new ChannelGraphError(
      payload.error?.message || `Graph API error (HTTP ${res.status})`,
      res.status,
      payload.error?.code,
    );
  }
  if (!payload.message_id) {
    throw new ChannelGraphError('Graph API returned no message_id', res.status);
  }
  return payload.message_id;
}

export async function sendChannelText(
  args: ChannelSendArgs,
  text: string,
): Promise<string> {
  return postMessage(args, { text });
}

export async function sendChannelMedia(
  args: ChannelSendArgs,
  kind: ChannelMediaKind,
  url: string,
  caption?: string,
): Promise<string> {
  const messageId = await postMessage(args, {
    attachment: {
      type: ATTACHMENT_TYPE[kind],
      payload: { url, is_reusable: true },
    },
  });

  // The Send API has no caption field — an attachment and its caption are
  // two messages. Only image/video carry one (Meta ignores the rest), and
  // a caption failure must not turn a delivered attachment into an error,
  // so this is best effort.
  if (caption && (kind === 'image' || kind === 'video')) {
    await postMessage(args, { text: caption }).catch((err) => {
      console.warn(
        '[channels] caption follow-up failed:',
        err instanceof Error ? err.message : err,
      );
    });
  }

  return messageId;
}

export interface ChannelProfile {
  name?: string;
  username?: string;
  avatarUrl?: string;
}

/**
 * Best-effort display name + avatar for a channel user.
 *
 * Meta gates profile lookups per channel: Messenger exposes `name` (and
 * only for users who have not restricted it), Instagram exposes
 * `name`/`username`. Any failure — missing permission, rate limit, user
 * opted out — returns null and the caller keeps the id as the display
 * name. Never throws: this runs inside the inbound webhook, and a
 * webhook that starts failing makes Meta retry the whole batch.
 */
export async function fetchChannelProfile(
  channel: MessagingChannel,
  args: { externalId: string; accessToken: string; userId: string },
): Promise<ChannelProfile | null> {
  const fields =
    channel === 'instagram'
      ? 'name,username,profile_pic'
      : 'name,profile_pic';

  try {
    const url = new URL(graphUrl(args.userId));
    url.searchParams.set('fields', fields);
    url.searchParams.set('access_token', args.accessToken);

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      name?: string;
      username?: string;
      profile_pic?: string;
    };
    const profile: ChannelProfile = {};
    if (data.name) profile.name = data.name;
    if (data.username) profile.username = data.username;
    if (data.profile_pic) profile.avatarUrl = data.profile_pic;
    return Object.keys(profile).length > 0 ? profile : null;
  } catch {
    return null;
  }
}

/**
 * Subscribe the connected Page/IG account to this app's webhook for
 * `messages` events. Called by the Settings connect flow so the admin
 * does not have to click through the Meta dashboard for the common case.
 */
export async function subscribePageToApp(args: {
  externalId: string;
  accessToken: string;
}): Promise<{ ok: boolean; error?: string }> {
  // Graph requires `subscribed_fields` on this call and answers
  // "(#100) The parameter subscribed_fields is required." without it. That
  // failure is silent in the UI — the channel row is written either way and
  // the tenant then wonders why no message ever arrives.
  const body = new URLSearchParams({
    subscribed_fields: 'messages,messaging_postbacks,message_reactions',
  });
  try {
    const res = await fetch(graphUrl(`${args.externalId}/subscribed_apps`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      return { ok: false, error: payload.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' };
  }
}
