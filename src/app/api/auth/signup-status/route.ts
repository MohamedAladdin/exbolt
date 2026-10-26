/**
 * Public registration state for the signup screen.
 *
 * Returns ONLY what the form needs to explain itself — never billing
 * config, never the allowlist. The authoritative lock is the
 * `enforce_signup_gate` trigger on auth.users, so a client that ignores
 * this endpoint still cannot create an account while registration is off.
 */

import { NextResponse } from 'next/server';

import { getPublicSignupState } from '@/lib/admin/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getPublicSignupState();
  return NextResponse.json(state, {
    headers: { 'cache-control': 'no-store' },
  });
}
