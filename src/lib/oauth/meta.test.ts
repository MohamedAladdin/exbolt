import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decrypt, encrypt } from '../whatsapp/encryption';
import {
  META_OAUTH_SCOPES,
  META_STATE_TTL_MS,
  MetaOAuthConfigError,
  MetaOAuthError,
  buildAuthUrl,
  buildChannelConfigRow,
  isMetaOAuthConfigured,
  listPages,
  metaOAuthRedirectUri,
  settingsTabForChannel,
  signState,
  verifyState,
  type MetaPage,
} from './meta';

const APP_ID = '1234567890';
const SECRET = 'app-secret';
const REDIRECT = 'https://bolt.excal.uk/api/oauth/meta/callback';

// `encrypt()` keys off ENCRYPTION_KEY, which vitest.config.ts injects.
const identity = (token: string) => `sealed:${token}`;

beforeEach(() => {
  vi.stubEnv('META_APP_ID', APP_ID);
  vi.stubEnv('META_APP_SECRET', SECRET);
  vi.stubEnv('META_OAUTH_REDIRECT_URI', REDIRECT);
  vi.stubEnv('META_ES_CONFIG_ID', '');
  vi.stubEnv('META_GRAPH_VERSION', 'v23.0');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('buildAuthUrl', () => {
  it('builds the Facebook OAuth dialog URL with the messenger scopes', () => {
    const url = new URL(
      buildAuthUrl({
        channel: 'messenger',
        state: 'state-abc',
        redirectUri: REDIRECT,
      })
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://www.facebook.com/v23.0/dialog/oauth'
    );
    expect(url.searchParams.get('client_id')).toBe(APP_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(
      'pages_show_list,pages_messaging,pages_manage_metadata,business_management'
    );
    // Embedded-Signup-only params must not leak into the Page flows.
    expect(url.searchParams.get('config_id')).toBeNull();
    expect(url.searchParams.get('extras')).toBeNull();
  });

  it('asks for the Instagram messaging scopes on the instagram flow', () => {
    const url = new URL(
      buildAuthUrl({ channel: 'instagram', state: 's', redirectUri: REDIRECT })
    );
    expect(url.searchParams.get('scope')).toBe(
      'instagram_basic,instagram_manage_messages,pages_show_list,business_management'
    );
  });

  it('keeps the WhatsApp management scopes and only adds config_id when configured', () => {
    const plain = new URL(
      buildAuthUrl({ channel: 'whatsapp', state: 's', redirectUri: REDIRECT })
    );
    expect(plain.searchParams.get('scope')).toBe(
      'whatsapp_business_management,whatsapp_business_messaging,business_management'
    );
    expect(plain.searchParams.get('config_id')).toBeNull();

    const withConfig = new URL(
      buildAuthUrl({
        channel: 'whatsapp',
        state: 's',
        redirectUri: REDIRECT,
        configId: 'es-config-1',
      })
    );
    expect(withConfig.searchParams.get('config_id')).toBe('es-config-1');
    expect(
      JSON.parse(withConfig.searchParams.get('extras') ?? '{}')
    ).toMatchObject({
      feature: 'whatsapp_embedded_signup',
    });
  });

  it('falls back to META_ES_CONFIG_ID for the WhatsApp flow', () => {
    vi.stubEnv('META_ES_CONFIG_ID', 'env-config');
    const url = new URL(
      buildAuthUrl({ channel: 'whatsapp', state: 's', redirectUri: REDIRECT })
    );
    expect(url.searchParams.get('config_id')).toBe('env-config');
  });

  it('uses the documented callback URI by default', () => {
    vi.stubEnv('META_OAUTH_REDIRECT_URI', '');
    expect(metaOAuthRedirectUri()).toBe(
      'https://bolt.excal.uk/api/oauth/meta/callback'
    );
  });

  it('throws a typed 503 error instead of building a URL without an app id', () => {
    vi.stubEnv('META_APP_ID', '');
    expect(isMetaOAuthConfigured()).toBe(false);
    expect(() =>
      buildAuthUrl({ channel: 'messenger', state: 's', redirectUri: REDIRECT })
    ).toThrow(MetaOAuthConfigError);
  });

  it('exposes scopes for every channel', () => {
    expect(Object.keys(META_OAUTH_SCOPES).sort()).toEqual([
      'instagram',
      'messenger',
      'whatsapp',
    ]);
  });
});

describe('signState / verifyState', () => {
  const payload = {
    channel: 'messenger' as const,
    account_id: 'acct-1',
    nonce: 'n1',
  };

  it('round-trips a valid state', () => {
    const now = 1_700_000_000_000;
    const state = signState(payload, { now });
    const result = verifyState(state, { now });

    expect(result).toEqual({
      ok: true,
      state: { ...payload, iat: now },
    });
  });

  it('rejects a state whose payload was edited (signature mismatch)', () => {
    const now = 1_700_000_000_000;
    const state = signState(payload, { now });
    const [, signature] = state.split('.');

    const forgedBody = Buffer.from(
      JSON.stringify({ ...payload, account_id: 'someone-else', iat: now }),
      'utf8'
    ).toString('base64url');

    const result = verifyState(`${forgedBody}.${signature}`, { now });
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered signature of the same length', () => {
    const now = 1_700_000_000_000;
    const state = signState(payload, { now });
    const [body, signature] = state.split('.');
    const flipped =
      signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');

    expect(verifyState(`${body}.${flipped}`, { now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('expires ten minutes after issue', () => {
    const now = 1_700_000_000_000;
    const state = signState(payload, { now });

    expect(verifyState(state, { now: now + META_STATE_TTL_MS - 1 }).ok).toBe(
      true
    );
    expect(verifyState(state, { now: now + META_STATE_TTL_MS + 1 })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects malformed, empty and multi-part states', () => {
    for (const bad of ['', 'nodot', 'a.b.c', '.sig', 'body.']) {
      expect(verifyState(bad).ok).toBe(false);
    }
  });

  it('rejects a far-future iat rather than never expiring it', () => {
    const now = 1_700_000_000_000;
    const state = signState(payload, { now: now + 60 * 60 * 1000 });
    expect(verifyState(state, { now })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('can pin the expected channel', () => {
    const state = signState(payload);
    expect(verifyState(state, { expectedChannel: 'whatsapp' })).toEqual({
      ok: false,
      reason: 'channel_mismatch',
    });
    expect(verifyState(state, { expectedChannel: 'messenger' }).ok).toBe(true);
  });

  it('refuses to sign without the pieces the callback needs', () => {
    expect(() => signState({ ...payload, account_id: '' })).toThrow();
    expect(() => signState({ ...payload, nonce: '' })).toThrow();
    expect(() =>
      signState({ ...payload, channel: 'telegram' as never })
    ).toThrow();
  });

  it('reports a config problem (not a forged state) when the key is unusable', () => {
    const state = signState(payload);
    vi.stubEnv('ENCRYPTION_KEY', 'too-short');
    expect(verifyState(state)).toEqual({ ok: false, reason: 'not_configured' });
  });
});

describe('buildChannelConfigRow (pages → channel_configs)', () => {
  const page: MetaPage = {
    id: '1029384756',
    name: 'Rado Coffee',
    access_token: 'EAAG-page-token',
    instagram_business_account: {
      id: '17841400000000000',
      username: 'rado.coffee',
    },
  };

  it('maps a Page to the messenger row and encrypts the Page token', () => {
    const result = buildChannelConfigRow({
      channel: 'messenger',
      page,
      encrypt: identity,
    });
    expect(result).toEqual({
      ok: true,
      row: {
        channel: 'messenger',
        external_id: '1029384756',
        display_name: 'Rado Coffee',
        access_token: 'sealed:EAAG-page-token',
        is_active: true,
      },
    });
  });

  it('maps a Page to the instagram row keyed by the IG business account', () => {
    const result = buildChannelConfigRow({
      channel: 'instagram',
      page,
      encrypt: identity,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.external_id).toBe('17841400000000000');
    expect(result.row.display_name).toBe('@rado.coffee');
    // Instagram messaging is authorized through the linked Page, so the
    // stored credential is the Page token — not an IG-scoped one.
    expect(result.row.access_token).toBe('sealed:EAAG-page-token');
  });

  it('falls back to the Page name when the IG account has no username', () => {
    const result = buildChannelConfigRow({
      channel: 'instagram',
      page: { ...page, instagram_business_account: { id: '1784140' } },
      encrypt: identity,
    });
    expect(result.ok && result.row.display_name).toBe('Rado Coffee');
  });

  it('rejects a Page without an IG business account for the instagram channel', () => {
    const result = buildChannelConfigRow({
      channel: 'instagram',
      page: { id: '1', name: 'No IG', access_token: 't' },
      encrypt: identity,
    });
    expect(result).toEqual({ ok: false, reason: 'instagram_account_missing' });
  });

  it('rejects a Page with no token instead of storing an empty credential', () => {
    const result = buildChannelConfigRow({
      channel: 'messenger',
      page: { id: '1', name: 'No token', access_token: '' },
      encrypt: identity,
    });
    expect(result).toEqual({ ok: false, reason: 'page_token_missing' });
  });

  it('produces a value the encryption helper can read back', () => {
    const result = buildChannelConfigRow({
      channel: 'messenger',
      page,
      // Round-trip through the real AES-256-GCM helper.
      encrypt,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.access_token).not.toContain('EAAG-page-token');
    expect(decrypt(result.row.access_token)).toBe('EAAG-page-token');
  });
});

describe('listPages', () => {
  function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return { ok, status, json: async () => body } as Response;
  }

  it('keeps usable Pages and drops entries without an id or token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: '111',
              name: 'One',
              access_token: 'tok-1',
              instagram_business_account: { id: '222', username: 'one.ig' },
            },
            { id: '333', name: 'No token' },
            { name: 'No id', access_token: 'tok-2' },
          ],
          paging: { next: 'https://evil.example.com/steal' },
        })
      )
    );

    const pages = await listPages('user-token');
    expect(pages).toEqual([
      {
        id: '111',
        name: 'One',
        access_token: 'tok-1',
        instagram_business_account: { id: '222', username: 'one.ig' },
      },
    ]);
  });

  it('surfaces Meta errors as a typed failure without echoing the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { message: 'Invalid OAuth access token' } },
          false,
          400
        )
      )
    );

    const error = await listPages('user-token').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MetaOAuthError);
    expect((error as Error).message).toBe('Invalid OAuth access token');
    // Credentials must never reach a log line or a surfaced error.
    expect((error as Error).message).not.toContain('user-token');
  });
});

describe('settingsTabForChannel', () => {
  it('routes WhatsApp to its own tab and the messaging channels to channels', () => {
    expect(settingsTabForChannel('whatsapp')).toBe('whatsapp');
    expect(settingsTabForChannel('messenger')).toBe('channels');
    expect(settingsTabForChannel('instagram')).toBe('channels');
  });
});
