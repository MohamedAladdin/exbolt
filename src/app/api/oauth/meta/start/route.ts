import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireFeature } from '@/lib/plans/guard';
import { isChannel } from '@/lib/channels/types';
import {
  META_STATE_COOKIE,
  META_STATE_SECONDS,
  buildAuthUrl,
  isMetaOAuthConfigured,
  metaOAuthRedirectUri,
  randomNonce,
  requestOrigin,
  settingsTabForChannel,
  signState,
} from '@/lib/oauth/meta';

/**
 * GET /api/oauth/meta/start?channel=whatsapp|messenger|instagram
 *
 * The "Connect with Facebook" button navigates here. We mint a signed state
 * (channel + account + nonce, 10 min TTL), pin it to an httpOnly cookie so
 * only the browser that started the flow can finish it, and hand off to the
 * Facebook OAuth dialog.
 *
 * Nothing secret is in the URL: `state` is an HMAC, not a token, and the
 * account it belongs to is only readable with ENCRYPTION_KEY.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const channel = requestUrl.searchParams.get('channel');

  const backTo = (tab: 'whatsapp' | 'channels', error: string) =>
    NextResponse.redirect(
      new URL(`/settings?tab=${tab}&error=${error}`, requestOrigin(request)),
      303
    );

  if (!isChannel(channel)) {
    return NextResponse.json(
      {
        error: 'channel must be "whatsapp", "messenger" or "instagram"',
        code: 'invalid_channel',
      },
      { status: 400 }
    );
  }

  const tab = settingsTabForChannel(channel);

  // Checked before auth so a misconfigured deploy answers with the actual
  // cause instead of bouncing the user back to Settings with a vague error.
  if (!isMetaOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          'Self-service Meta connection is not configured on this server. Set META_OAUTH_APP_ID and META_OAUTH_APP_SECRET (or META_APP_ID / META_APP_SECRET), or use the manual setup.',
        code: 'meta_oauth_not_configured',
      },
      { status: 503 }
    );
  }

  let ctx;
  try {
    // `inbox` is the capability the channels hang off: a suspended plan must
    // not be able to attach a new number or Page.
    ctx = await requireFeature('inbox', 'admin');
  } catch (err) {
    if (err instanceof Error && err.name === 'PlanError') {
      return backTo(tab, 'plan');
    }
    if (
      err instanceof Error &&
      (err.name === 'UnauthorizedError' || err.name === 'ForbiddenError')
    ) {
      return backTo(tab, 'forbidden');
    }
    return toErrorResponse(err);
  }

  let state: string;
  let authUrl: string;
  try {
    state = signState({
      channel,
      account_id: ctx.accountId,
      nonce: randomNonce(),
    });
    authUrl = buildAuthUrl({
      channel,
      state,
      redirectUri: metaOAuthRedirectUri(),
    });
  } catch (err) {
    // Missing/malformed ENCRYPTION_KEY is a 503, not a crash.
    console.error(
      '[oauth/meta/start] cannot build the authorization URL:',
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      {
        error:
          'Meta OAuth is misconfigured on this server (signing key unavailable).',
        code: 'meta_oauth_not_configured',
      },
      { status: 503 }
    );
  }

  const response = NextResponse.redirect(authUrl, 302);
  response.cookies.set(META_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: META_STATE_SECONDS,
  });
  return response;
}
