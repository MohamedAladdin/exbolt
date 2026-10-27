import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { toErrorResponse } from '@/lib/auth/account';
import { requireFeature } from '@/lib/plans/guard';
import { isMessagingChannel } from '@/lib/channels/types';
import { decrypt } from '@/lib/whatsapp/encryption';
import { connectMessagingChannel } from '@/lib/oauth/connect';
import {
  META_PAGES_COOKIE,
  MetaOAuthError,
  listPages,
  requestOrigin,
} from '@/lib/oauth/meta';

/**
 * POST /api/oauth/meta/connect
 *
 * The multi-Page chooser submits here (a plain form POST, so it works with
 * JS disabled and without shipping Page tokens to the client). The sealed
 * user token from the callback is the only credential in the browser; the
 * Page tokens are fetched fresh from Graph, matched against the submitted
 * `page_id`, and encrypted before they are stored.
 */

export const dynamic = 'force-dynamic';

function redirectTo(
  origin: string,
  params: Record<string, string>
): NextResponse {
  const url = new URL('/settings', origin);
  url.searchParams.set('tab', 'channels');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

function finish(origin: string, params: Record<string, string>): NextResponse {
  const response = redirectTo(origin, params);
  response.cookies.set(META_PAGES_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function POST(request: Request) {
  const origin = requestOrigin(request);

  let ctx;
  try {
    ctx = await requireFeature('inbox', 'admin');
  } catch (err) {
    if (err instanceof Error && err.name === 'PlanError') {
      return finish(origin, { error: 'plan' });
    }
    if (
      err instanceof Error &&
      (err.name === 'UnauthorizedError' || err.name === 'ForbiddenError')
    ) {
      return finish(origin, { error: 'forbidden' });
    }
    return toErrorResponse(err);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return finish(origin, { error: 'generic' });

  const channel = form.get('channel');
  const pageId = form.get('page_id');
  if (!isMessagingChannel(channel) || typeof pageId !== 'string' || !pageId) {
    return finish(origin, { error: 'generic' });
  }

  const sealed = (await cookies()).get(META_PAGES_COOKIE)?.value ?? '';
  if (!sealed) return finish(origin, { error: 'state' });

  let userToken: string;
  try {
    userToken = decrypt(sealed);
  } catch {
    // Wrong key or a tampered cookie — either way, start over.
    return finish(origin, { error: 'state' });
  }

  let page;
  try {
    const pages = await listPages(userToken);
    page = pages.find((candidate) => candidate.id === pageId);
  } catch (err) {
    console.error(
      '[oauth/meta/connect] page lookup failed:',
      err instanceof MetaOAuthError ? err.message : 'unexpected error'
    );
    return finish(origin, { error: 'exchange' });
  }

  if (!page) return finish(origin, { error: 'state' });

  const result = await connectMessagingChannel({
    accountId: ctx.accountId,
    channel,
    page,
  });

  if (!result.ok) {
    return finish(origin, {
      error:
        result.reason === 'linked_elsewhere'
          ? 'linked_elsewhere'
          : result.reason === 'instagram_account_missing'
            ? 'no_instagram'
            : result.reason === 'db_error'
              ? 'db'
              : 'generic',
    });
  }

  return finish(origin, { connected: channel });
}

/** The chooser page's "Cancel" link can be a plain GET back to Settings. */
export async function GET(request: Request) {
  const origin = requestOrigin(request);
  return finish(origin, {});
}
