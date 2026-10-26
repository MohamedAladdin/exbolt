/**
 * Channel vocabulary for the inbox.
 *
 * A *channel* is the transport a conversation arrives on: WhatsApp
 * (official Cloud API), Messenger (Facebook Page DMs) or Instagram DMs.
 * It is orthogonal to tenancy — every channel lives inside the same
 * account, contact book and inbox; it only changes how a message is
 * addressed and delivered.
 *
 * WhatsApp stays the default everywhere (`DEFAULT_CHANNEL`) so rows that
 * predate migration 060 keep working unchanged.
 */

export const CHANNELS = ['whatsapp', 'messenger', 'instagram'] as const;

export type Channel = (typeof CHANNELS)[number];

/** Channels that are NOT WhatsApp — the ones `channel_configs` holds. */
export const MESSAGING_CHANNELS = ['messenger', 'instagram'] as const;

export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

export const DEFAULT_CHANNEL: Channel = 'whatsapp';

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

export function isMessagingChannel(value: unknown): value is MessagingChannel {
  return (
    typeof value === 'string' &&
    (MESSAGING_CHANNELS as readonly string[]).includes(value)
  );
}

/**
 * Coerce a DB value (or an API input) to a Channel. Rows written before
 * migration 060 have no `channel` column value at all, so `null`,
 * `undefined` and unknown strings all read as WhatsApp — the same thing
 * the column default says.
 */
export function toChannel(value: unknown): Channel {
  return isChannel(value) ? value : DEFAULT_CHANNEL;
}

/** Human label — intentionally untranslated here; the UI localises. */
export const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
};

/**
 * Webhook `object` value → channel. Meta sends `page` for Messenger
 * events and `instagram` for IG DMs; anything else (including the
 * `whatsapp_business_account` object) is not a messaging-channel event.
 */
export function channelForWebhookObject(object: unknown): MessagingChannel | null {
  if (object === 'page') return 'messenger';
  if (object === 'instagram') return 'instagram';
  return null;
}
