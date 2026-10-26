/**
 * Platform-admin gate.
 *
 * `platform_admins` is service-role only (no RLS policy), so the
 * membership check itself has to run through the admin client. The
 * caller's identity still comes from the SSR client's cookie session —
 * never from a header or a query parameter.
 *
 * Usage in a route handler:
 *
 *   try {
 *     const admin = await requirePlatformAdmin();
 *     ...
 *   } catch (err) {
 *     return adminErrorResponse(err);
 *   }
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { adminDb } from './db';

export class AdminAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 500 = 403
  ) {
    super(message);
    this.name = 'AdminAuthError';
  }
}

export interface PlatformAdmin {
  userId: string;
  email: string;
}

/** True when the signed-in user is a platform admin. Never throws. */
export async function isPlatformAdmin(): Promise<boolean> {
  try {
    await requirePlatformAdmin();
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the caller and assert platform-admin membership.
 * Throws `AdminAuthError` (401 not signed in, 403 not an admin).
 */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AdminAuthError('unauthorized', 401);
  }

  const { data, error: adminError } = await adminDb()
    .from('platform_admins')
    .select('user_id, email')
    .eq('user_id', user.id)
    .maybeSingle();

  if (adminError) {
    console.error('[admin] platform_admins lookup failed:', adminError.message);
    throw new AdminAuthError('admin_check_failed', 500);
  }

  if (!data) {
    throw new AdminAuthError('forbidden', 403);
  }

  return {
    userId: user.id,
    email: (data.email as string | null) ?? user.email ?? '',
  };
}

/** Map an error from the gate onto an HTTP response. */
export function adminErrorResponse(err: unknown): NextResponse {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'unknown_error';
  // `admin:*` codes are ours and safe to surface; anything else is not.
  const safe = message.startsWith('admin_') || message.startsWith('invalid_');
  return NextResponse.json(
    { error: safe ? message : 'internal_error' },
    { status: safe ? 400 : 500 }
  );
}
