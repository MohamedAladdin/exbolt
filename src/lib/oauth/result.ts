/**
 * Error codes the Meta OAuth callback bounces back to Settings with.
 *
 * They travel as `?error=<code>` in a redirect — never a message, never a
 * token — so the UI owns the wording (and its Arabic translation) and the
 * URL stays loggable. `oauthMessageKey` maps a code onto the catalogue key
 * used under `Settings.channels.oauth.error.*` and
 * `Settings.whatsapp.oauth.error.*`; an unknown code falls back to
 * `generic` rather than rendering a raw keypath.
 */

import { CHANNELS, isChannel, type Channel } from '@/lib/channels/types';

export const OAUTH_ERROR_CODES = [
  'state',
  'state_expired',
  'denied',
  'forbidden',
  'plan',
  'no_pages',
  'no_instagram',
  'linked_elsewhere',
  'number_taken',
  'phone_not_found',
  'setup',
  'exchange',
  'db',
  'generic',
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export function isOAuthErrorCode(value: unknown): value is OAuthErrorCode {
  return (
    typeof value === 'string' &&
    (OAUTH_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** Catalogue key (relative to the panel namespace) for `code`. */
export function oauthMessageKey(code: string | null | undefined): string {
  return `oauth.error.${isOAuthErrorCode(code) ? code : 'generic'}`;
}

/** `?connected=` only ever carries a known channel name. */
export function isOAuthConnectedChannel(value: unknown): value is Channel {
  return isChannel(value) && (CHANNELS as readonly string[]).includes(value);
}
