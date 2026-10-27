/**
 * Meta OAuth — self-service channel connection.
 *
 * Three flows share one Facebook Login app:
 *
 *   whatsapp   Embedded Signup (`config_id` + the `waba_id` /
 *              `phone_number_id` the dialog hands back in the callback)
 *   messenger  `pages_*` scopes → `/me/accounts` → Page token
 *   instagram  `instagram_*` + `pages_show_list` → the Page's
 *              `instagram_business_account` → Page token
 *
 * Everything here is pure/IO-only and free of Next.js imports so it can be
 * unit-tested directly (see meta.test.ts). Route handlers own the cookies,
 * the database writes and the redirects.
 *
 * Secrets: `META_APP_SECRET` never leaves the server, tokens are returned to
 * callers but never logged, and the OAuth `state` is an HMAC over the JSON
 * payload keyed with the same `ENCRYPTION_KEY` the token store uses — so a
 * forged state cannot survive a restart with a different key, and the
 * account id inside it cannot be edited by the browser.
 */

import crypto from 'node:crypto';

import {
  CHANNELS,
  isChannel,
  type Channel,
  type MessagingChannel,
} from '@/lib/channels/types';
import { graphUrl, graphVersion } from '@/lib/channels/graph-api';

/** Facebook Login dialog host (graph version comes from graphVersion()). */
export const META_OAUTH_DIALOG_BASE = 'https://www.facebook.com';

/** Callback registered in the Meta app dashboard. Overridable per deploy. */
export const DEFAULT_META_OAUTH_REDIRECT_URI =
  'https://bolt.excal.uk/api/oauth/meta/callback';

/** Correlation cookie for the in-flight authorization request. */
export const META_STATE_COOKIE = 'meta_oauth_state';

/**
 * Holds the (AES-GCM sealed) user token between the callback and the
 * multi-Page chooser POST. Never the raw token, never the Page tokens.
 */
export const META_PAGES_COOKIE = 'meta_oauth_pages';

/** A state older than this is rejected — bounds replay of a leaked URL. */
export const META_STATE_TTL_MS = 10 * 60 * 1000;
export const META_STATE_SECONDS = META_STATE_TTL_MS / 1000;

/** Tolerated clock skew when checking `iat` in the future. */
const CLOCK_SKEW_MS = 60 * 1000;

/**
 * Per-channel scopes. Order is part of the contract (tests assert it) and
 * matches what the Meta app review grants, so the consent screen lists the
 * permissions the dashboard documents.
 */
export const META_OAUTH_SCOPES: Record<Channel, readonly string[]> = {
  whatsapp: [
    'whatsapp_business_management',
    'whatsapp_business_messaging',
    'business_management',
  ],
  messenger: [
    'pages_show_list',
    'pages_messaging',
    'pages_manage_metadata',
    'business_management',
  ],
  instagram: [
    'instagram_basic',
    'instagram_manage_messages',
    'pages_show_list',
    'business_management',
  ],
};

export class MetaOAuthConfigError extends Error {
  readonly code = 'meta_oauth_not_configured';
  readonly status = 503 as const;

  constructor(
    message = 'Meta OAuth is not configured on this server (META_APP_ID / META_APP_SECRET are missing).'
  ) {
    super(message);
    this.name = 'MetaOAuthConfigError';
  }
}

export class MetaOAuthError extends Error {
  constructor(
    message: string,
    readonly status: number = 502
  ) {
    super(message);
    this.name = 'MetaOAuthError';
  }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export function metaAppId(): string | null {
  // Dedicated OAuth credentials win. The deployment's META_APP_ID stays
  // whatever it is (a customer's own app, on this box) so adding the
  // self-service flow never re-points resumable template uploads or the
  // subscribed-apps diagnostics at a different app.
  // Note: an env var set to an empty string must fall through, so this is an
  // explicit non-empty check rather than `??`.
  const value =
    process.env.META_OAUTH_APP_ID?.trim() ||
    process.env.META_APP_ID?.trim();
  return value ? value : null;
}

export function metaAppSecret(): string | null {
  const dedicated = process.env.META_OAUTH_APP_SECRET?.trim();
  if (dedicated) return dedicated;
  const value = process.env.META_APP_SECRET?.trim();
  // META_APP_SECRET may hold a comma-separated rotation list (see
  // docs/meta-app-rotation.md); the OAuth exchange uses the first entry.
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first ? first : null;
}

export function metaOAuthRedirectUri(): string {
  const value = process.env.META_OAUTH_REDIRECT_URI?.trim();
  return value ? value : DEFAULT_META_OAUTH_REDIRECT_URI;
}

/** Embedded Signup configuration id — only needed for the WhatsApp flow. */
export function metaEmbeddedSignupConfigId(): string | null {
  const value = process.env.META_ES_CONFIG_ID?.trim();
  return value ? value : null;
}

/** True when the OAuth routes can run at all. */
export function isMetaOAuthConfigured(): boolean {
  return metaAppId() !== null && metaAppSecret() !== null;
}

function requireAppCredentials(): { appId: string; appSecret: string } {
  const appId = metaAppId();
  const appSecret = metaAppSecret();
  if (!appId || !appSecret) throw new MetaOAuthConfigError();
  return { appId, appSecret };
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

export interface BuildAuthUrlArgs {
  channel: Channel;
  state: string;
  redirectUri: string;
  /** Embedded Signup config id; defaults to META_ES_CONFIG_ID. */
  configId?: string | null;
}

/**
 * Facebook OAuth dialog URL for `channel`.
 *
 * WhatsApp adds the Embedded Signup extras: `config_id` (from the Meta app's
 * WhatsApp → Embedded Signup configuration) is what makes the dialog render
 * the WABA/number picker and hand `waba_id` + `phone_number_id` back to the
 * callback. `sessionInfoVersion=3` enables the JS `message` events for
 * clients that embed the dialog themselves.
 */
export function buildAuthUrl(args: BuildAuthUrlArgs): string {
  const { appId } = requireAppCredentials();
  if (!isChannel(args.channel))
    throw new Error('buildAuthUrl: unknown channel');
  if (!args.state) throw new Error('buildAuthUrl: state is required');
  if (!args.redirectUri)
    throw new Error('buildAuthUrl: redirectUri is required');

  const url = new URL(
    `${META_OAUTH_DIALOG_BASE}/${graphVersion()}/dialog/oauth`
  );
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('state', args.state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', META_OAUTH_SCOPES[args.channel].join(','));

  if (args.channel === 'whatsapp') {
    const configId =
      args.configId === undefined
        ? metaEmbeddedSignupConfigId()
        : args.configId;
    if (configId) {
      url.searchParams.set('config_id', configId);
      url.searchParams.set(
        'extras',
        JSON.stringify({
          feature: 'whatsapp_embedded_signup',
          version: 2,
          sessionInfoVersion: '3',
        })
      );
    }
  }

  return url.toString();
}

// ---------------------------------------------------------------------------
// State (HMAC-signed, 10-minute TTL)
// ---------------------------------------------------------------------------

export interface MetaOAuthStateInput {
  channel: Channel;
  account_id: string;
  nonce: string;
}

export interface MetaOAuthState extends MetaOAuthStateInput {
  iat: number;
}

export type VerifyStateResult =
  | { ok: true; state: MetaOAuthState }
  | {
      ok: false;
      reason:
        | 'malformed'
        | 'bad_signature'
        | 'expired'
        | 'not_configured'
        | 'channel_mismatch';
    };

function stateKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim() ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new MetaOAuthConfigError(
      'ENCRYPTION_KEY must be a 64-character hex string to sign OAuth state.'
    );
  }
  return Buffer.from(raw, 'hex');
}

function hmacState(body: string): string {
  return crypto
    .createHmac('sha256', stateKey())
    .update(body)
    .digest('base64url');
}

export function randomNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** `base64url(json).base64url(hmac)` — URL-safe, so it survives a redirect. */
export function signState(
  payload: MetaOAuthStateInput,
  options: { now?: number } = {}
): string {
  if (!isChannel(payload.channel)) {
    throw new Error('signState: unknown channel');
  }
  if (!payload.account_id) throw new Error('signState: account_id is required');
  if (!payload.nonce) throw new Error('signState: nonce is required');

  const body = Buffer.from(
    JSON.stringify({
      channel: payload.channel,
      account_id: payload.account_id,
      nonce: payload.nonce,
      iat: options.now ?? Date.now(),
    }),
    'utf8'
  ).toString('base64url');

  return `${body}.${hmacState(body)}`;
}

export function verifyState(
  raw: string,
  options: { now?: number; expectedChannel?: Channel } = {}
): VerifyStateResult {
  const now = options.now ?? Date.now();
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'malformed' };
  }

  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'malformed' };
  }

  let expected: string;
  try {
    expected = hmacState(parts[0]);
  } catch {
    // No usable key — a config problem, not a bad state.
    return { ok: false, reason: 'not_configured' };
  }

  const given = Buffer.from(parts[1], 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (
    given.length !== wanted.length ||
    !crypto.timingSafeEqual(given, wanted)
  ) {
    return { ok: false, reason: 'bad_signature' };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return { ok: false, reason: 'malformed' };
  }
  const candidate = decoded as Record<string, unknown>;
  const { channel, account_id: accountId, nonce, iat } = candidate;

  if (!isChannel(channel)) return { ok: false, reason: 'malformed' };
  if (typeof accountId !== 'string' || accountId.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof nonce !== 'string' || nonce.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof iat !== 'number' || !Number.isFinite(iat)) {
    return { ok: false, reason: 'malformed' };
  }

  // A signature we minted cannot be in the future by more than clock skew,
  // so a far-future `iat` means the payload was replayed from a clock we do
  // not control — treat it as malformed rather than letting it never expire.
  if (iat - now > CLOCK_SKEW_MS) return { ok: false, reason: 'malformed' };
  if (now - iat > META_STATE_TTL_MS) return { ok: false, reason: 'expired' };
  if (options.expectedChannel && channel !== options.expectedChannel) {
    return { ok: false, reason: 'channel_mismatch' };
  }

  return {
    ok: true,
    state: { channel, account_id: accountId, nonce, iat },
  };
}

/**
 * Constant-time string comparison for the state cookie ↔ query param check.
 * `===` on two attacker-influenced strings leaks length/prefix timing; cheap
 * to avoid.
 */
export function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a ?? '', 'utf8');
  const right = Buffer.from(b ?? '', 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface MetaToken {
  accessToken: string;
  expiresIn: number | null;
  tokenType: string | null;
}

interface GraphTokenPayload {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; code?: number };
}

async function readTokenResponse(res: Response): Promise<MetaToken> {
  const payload = (await res.json().catch(() => ({}))) as GraphTokenPayload;
  if (!res.ok || payload.error || !payload.access_token) {
    // Meta's message never contains the code or a token, but keep the
    // fallback generic so a future API change cannot echo one either.
    throw new MetaOAuthError(
      payload.error?.message ||
        `Meta rejected the OAuth token request (HTTP ${res.status})`,
      res.status >= 400 && res.status < 500 ? 400 : 502
    );
  }
  return {
    accessToken: payload.access_token,
    expiresIn:
      typeof payload.expires_in === 'number' ? payload.expires_in : null,
    tokenType: payload.token_type ?? null,
  };
}

/**
 * `code` → short-lived user token → long-lived (≈60 day) user token.
 *
 * The long-lived exchange is not optional: Page/IG tokens derived from a
 * short-lived user token expire in an hour, which would look like a working
 * connection that dies the same afternoon.
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<MetaToken> {
  const { appId, appSecret } = requireAppCredentials();
  if (!code) throw new MetaOAuthError('OAuth callback carried no code', 400);
  if (!redirectUri) {
    throw new MetaOAuthError('OAuth redirect URI is not configured', 500);
  }

  const shortUrl = new URL(graphUrl('oauth/access_token'));
  shortUrl.searchParams.set('client_id', appId);
  shortUrl.searchParams.set('client_secret', appSecret);
  shortUrl.searchParams.set('redirect_uri', redirectUri);
  shortUrl.searchParams.set('code', code);

  const shortRes = await fetch(shortUrl, {
    signal: AbortSignal.timeout(15000),
  });
  const shortLived = await readTokenResponse(shortRes);

  const longUrl = new URL(graphUrl('oauth/access_token'));
  longUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longUrl.searchParams.set('client_id', appId);
  longUrl.searchParams.set('client_secret', appSecret);
  longUrl.searchParams.set('fb_exchange_token', shortLived.accessToken);

  const longRes = await fetch(longUrl, { signal: AbortSignal.timeout(15000) });
  return readTokenResponse(longRes);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export interface MetaInstagramAccount {
  id: string;
  username?: string;
}

export interface MetaPage {
  id: string;
  name: string;
  /** Page access token — derived from the long-lived user token. */
  access_token: string;
  instagram_business_account?: MetaInstagramAccount;
}

interface GraphPagesPayload {
  data?: Array<{
    id?: string;
    name?: string;
    access_token?: string;
    instagram_business_account?: { id?: string; username?: string };
  }>;
  paging?: { next?: string };
  error?: { message?: string };
}

/** Pages the authorizing user administers, with their Page tokens. */
export async function listPages(userToken: string): Promise<MetaPage[]> {
  if (!userToken) throw new MetaOAuthError('Missing user token', 400);

  const pages: MetaPage[] = [];
  let next: URL | null = new URL(graphUrl('me/accounts'));
  next.searchParams.set(
    'fields',
    'id,name,access_token,instagram_business_account{id,username}'
  );
  next.searchParams.set('limit', '100');
  next.searchParams.set('access_token', userToken);

  for (let page = 0; next && page < 5; page++) {
    const res = await fetch(next, { signal: AbortSignal.timeout(15000) });
    const payload = (await res.json().catch(() => ({}))) as GraphPagesPayload;
    if (!res.ok || payload.error) {
      throw new MetaOAuthError(
        payload.error?.message ||
          `Meta refused the Page list (HTTP ${res.status})`,
        res.status >= 400 && res.status < 500 ? 400 : 502
      );
    }

    for (const raw of payload.data ?? []) {
      if (!raw?.id || !raw?.access_token) continue;
      const ig = raw.instagram_business_account;
      const entry: MetaPage = {
        id: raw.id,
        name: raw.name ?? raw.id,
        access_token: raw.access_token,
      };
      if (ig?.id) {
        entry.instagram_business_account = ig.username
          ? { id: ig.id, username: ig.username }
          : { id: ig.id };
      }
      pages.push(entry);
    }

    const link = payload.paging?.next;
    next =
      link && link.startsWith('https://graph.facebook.com/')
        ? new URL(link)
        : null;
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Page → channel_configs mapping
// ---------------------------------------------------------------------------

export interface ChannelConfigDraft {
  channel: MessagingChannel;
  external_id: string;
  display_name: string | null;
  /** Already encrypted — this is what lands in channel_configs.access_token. */
  access_token: string;
  is_active: true;
}

export type BuildChannelConfigResult =
  | { ok: true; row: ChannelConfigDraft }
  | {
      ok: false;
      reason: 'instagram_account_missing' | 'page_token_missing';
    };

/**
 * Map a Page from `/me/accounts` onto a `channel_configs` row.
 *
 * Messenger keys off the Page id. Instagram keys off the Page's
 * `instagram_business_account.id` — the inbound webhook addresses IG
 * messages by IGSID, and the Send API posts to that id — while the *token*
 * is still the Page token (Instagram messaging is authorized through the
 * linked Page). A Page without an IG business account cannot serve the
 * Instagram channel, so it is rejected rather than stored half-wired.
 *
 * `encrypt` is injected so this stays pure and testable (the route passes
 * `encrypt` from src/lib/whatsapp/encryption.ts).
 */
export function buildChannelConfigRow(args: {
  channel: MessagingChannel;
  page: MetaPage;
  encrypt: (token: string) => string;
}): BuildChannelConfigResult {
  const { channel, page, encrypt } = args;

  if (!page.access_token) return { ok: false, reason: 'page_token_missing' };

  if (channel === 'instagram') {
    const ig = page.instagram_business_account;
    if (!ig?.id) return { ok: false, reason: 'instagram_account_missing' };
    return {
      ok: true,
      row: {
        channel,
        external_id: ig.id,
        display_name: ig.username ? `@${ig.username}` : page.name,
        access_token: encrypt(page.access_token),
        is_active: true,
      },
    };
  }

  return {
    ok: true,
    row: {
      channel,
      external_id: page.id,
      display_name: page.name,
      access_token: encrypt(page.access_token),
      is_active: true,
    },
  };
}

/** Settings tab that owns the connect UI for `channel`. */
export function settingsTabForChannel(
  channel: Channel
): 'whatsapp' | 'channels' {
  return channel === 'whatsapp' ? 'whatsapp' : 'channels';
}

/** Channel names accepted by `/api/oauth/meta/start`. */
export function isOAuthChannel(value: unknown): value is Channel {
  return isChannel(value) && (CHANNELS as readonly string[]).includes(value);
}
