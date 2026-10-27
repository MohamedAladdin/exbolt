import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { toErrorResponse } from '@/lib/auth/account';
import { requireFeature } from '@/lib/plans/guard';
import { isMessagingChannel, type Channel } from '@/lib/channels/types';
import { encrypt } from '@/lib/whatsapp/encryption';
import { isNumericMetaId } from '@/lib/whatsapp/waba-pairing';
import {
  connectMessagingChannel,
  connectWhatsAppNumber,
} from '@/lib/oauth/connect';
import {
  META_PAGES_COOKIE,
  META_STATE_COOKIE,
  META_STATE_SECONDS,
  MetaOAuthError,
  exchangeCodeForToken,
  isMetaOAuthConfigured,
  listPages,
  metaOAuthRedirectUri,
  safeCompare,
  settingsTabForChannel,
  verifyState,
} from '@/lib/oauth/meta';

/**
 * GET /api/oauth/meta/callback
 *
 * Meta redirects here with `code` + `state` (or `error`). We verify the
 * state against the httpOnly cookie set by /start, exchange the code for a
 * long-lived user token, and then:
 *
 *   whatsapp   write whatsapp_config from the `waba_id` / `phone_number_id`
 *              Embedded Signup appended to the callback
 *   messenger  one Page → connect it; several → ask which one
 *   instagram  same, keyed off the Page's IG business account
 *
 * Every outcome ends in a redirect to Settings with `?connected=` or
 * `?error=`; tokens never appear in a URL, a log line or a response body.
 */

export const dynamic = 'force-dynamic';

type Tab = 'whatsapp' | 'channels';

function redirectBack(
  origin: string,
  tab: Tab,
  params: Record<string, string>
): NextResponse {
  const url = new URL('/settings', origin);
  url.searchParams.set('tab', tab);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

function clearCookie(response: NextResponse, name: string): NextResponse {
  response.cookies.set(name, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

function errorRedirect(origin: string, tab: Tab, code: string): NextResponse {
  return clearCookie(
    redirectBack(origin, tab, { error: code }),
    META_STATE_COOKIE
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const params = requestUrl.searchParams;
  const origin = requestUrl.origin;

  const cookieStore = await cookies();
  const stateParam = params.get('state') ?? '';
  const cookieState = cookieStore.get(META_STATE_COOKIE)?.value ?? '';

  const verified = verifyState(stateParam);
  const channel: Channel | null = verified.ok ? verified.state.channel : null;
  const tab: Tab = channel ? settingsTabForChannel(channel) : 'channels';

  // 1. The customer clicked "Cancel" on the Facebook dialog.
  if (params.get('error')) {
    return errorRedirect(origin, tab, 'denied');
  }

  // 2. The state must round-trip through the httpOnly cookie *and* carry a
  //    valid signature — the cookie is what proves this browser started the
  //    flow; the signature is what proves the account id was not edited.
  if (!stateParam || !cookieState || !safeCompare(stateParam, cookieState)) {
    return errorRedirect(origin, tab, 'state');
  }
  if (!verified.ok) {
    return errorRedirect(
      origin,
      tab,
      verified.reason === 'expired' ? 'state_expired' : 'state'
    );
  }

  const code = params.get('code') ?? '';
  if (!code) return errorRedirect(origin, tab, 'state');

  // 3. Configuration is checked before anything else touches Meta so a
  //    half-configured deploy says so (503 JSON) instead of crashing.
  if (!isMetaOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          'Self-service Meta connection is not configured on this server. Set META_APP_ID and META_APP_SECRET, or use the manual setup.',
        code: 'meta_oauth_not_configured',
      },
      { status: 503 }
    );
  }

  // 4. Same gate as /start: the session must still be an admin on a plan
  //    with the inbox, and on the *same* account that started the flow.
  let ctx;
  try {
    ctx = await requireFeature('inbox', 'admin');
  } catch (err) {
    if (err instanceof Error && err.name === 'PlanError') {
      return errorRedirect(origin, tab, 'plan');
    }
    if (
      err instanceof Error &&
      (err.name === 'UnauthorizedError' || err.name === 'ForbiddenError')
    ) {
      return errorRedirect(origin, tab, 'forbidden');
    }
    return toErrorResponse(err);
  }

  if (ctx.accountId !== verified.state.account_id) {
    return errorRedirect(origin, tab, 'state');
  }

  // 5. code → short-lived → long-lived user token.
  let userToken: string;
  try {
    const token = await exchangeCodeForToken(code, metaOAuthRedirectUri());
    userToken = token.accessToken;
  } catch (err) {
    console.error(
      '[oauth/meta/callback] token exchange failed:',
      err instanceof MetaOAuthError ? err.message : 'unexpected error'
    );
    return errorRedirect(origin, tab, 'exchange');
  }

  // ---- WhatsApp (Embedded Signup) -------------------------------------
  if (verified.state.channel === 'whatsapp') {
    const wabaId = params.get('waba_id') ?? '';
    const phoneNumberId = params.get('phone_number_id') ?? '';

    // Embedded Signup appends these to the redirect. Without them there is
    // nothing to store — the token alone does not name a number.
    if (!isNumericMetaId(wabaId) || !isNumericMetaId(phoneNumberId)) {
      return errorRedirect(origin, 'whatsapp', 'setup');
    }

    const result = await connectWhatsAppNumber({
      accountId: ctx.accountId,
      userId: ctx.userId,
      wabaId,
      phoneNumberId,
      accessToken: userToken,
    });

    if (!result.ok) {
      const code =
        result.reason === 'number_taken'
          ? 'number_taken'
          : result.reason === 'phone_not_found'
            ? 'phone_not_found'
            : result.reason === 'meta_error'
              ? 'exchange'
              : 'db';
      return errorRedirect(origin, 'whatsapp', code);
    }

    return clearCookie(
      redirectBack(origin, 'whatsapp', { connected: 'whatsapp' }),
      META_STATE_COOKIE
    );
  }

  // ---- Messenger / Instagram ------------------------------------------
  if (!isMessagingChannel(verified.state.channel)) {
    return errorRedirect(origin, tab, 'generic');
  }
  const messagingChannel = verified.state.channel;

  let pages;
  try {
    pages = await listPages(userToken);
  } catch (err) {
    console.error(
      '[oauth/meta/callback] page list failed:',
      err instanceof MetaOAuthError ? err.message : 'unexpected error'
    );
    return errorRedirect(origin, tab, 'exchange');
  }

  const candidates =
    messagingChannel === 'instagram'
      ? pages.filter((page) => page.instagram_business_account?.id)
      : pages;

  if (pages.length === 0) {
    return errorRedirect(origin, tab, 'no_pages');
  }
  if (candidates.length === 0) {
    return errorRedirect(origin, tab, 'no_instagram');
  }

  if (candidates.length === 1) {
    const result = await connectMessagingChannel({
      accountId: ctx.accountId,
      channel: messagingChannel,
      page: candidates[0],
    });
    if (!result.ok) {
      return errorRedirect(
        origin,
        tab,
        result.reason === 'linked_elsewhere'
          ? 'linked_elsewhere'
          : result.reason === 'instagram_account_missing'
            ? 'no_instagram'
            : result.reason === 'db_error'
              ? 'db'
              : 'generic'
      );
    }
    return clearCookie(
      redirectBack(origin, tab, { connected: messagingChannel }),
      META_STATE_COOKIE
    );
  }

  // Several Pages: hand the (sealed) user token to the chooser instead of
  // the Page list. Page tokens are ~200 bytes each and would blow the 4 KB
  // cookie budget, and they have no business sitting in the browser at all.
  const chooserUrl = new URL('/settings/channels/choose', origin);
  chooserUrl.searchParams.set('channel', messagingChannel);

  const response = NextResponse.redirect(chooserUrl, 303);
  clearCookie(response, META_STATE_COOKIE);
  response.cookies.set(META_PAGES_COOKIE, encrypt(userToken), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: META_STATE_SECONDS,
  });
  return response;
}
