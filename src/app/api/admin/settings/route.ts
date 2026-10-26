/**
 * /api/admin/settings — registration gate, mail identity, reminder policy,
 * platform admins and the signup allowlist.
 *
 *   PATCH { signupEnabled?, signupMode?, signupClosedMessage?, … }
 *   POST  { action: "add_admin", email, note? }
 *   POST  { action: "remove_admin", userId }
 *   POST  { action: "allow", email, note?, expiresAt? }
 *   POST  { action: "unallow", email }
 */

import { NextResponse } from 'next/server';

import { requirePlatformAdmin, adminErrorResponse } from '@/lib/admin/auth';
import {
  addPlatformAdmin,
  addToAllowlist,
  removeFromAllowlist,
  removePlatformAdmin,
  updateSettings,
} from '@/lib/admin/mutations';

export async function PATCH(request: Request) {
  try {
    const actor = await requirePlatformAdmin();
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new Error('invalid_body');
    const result = await updateSettings(actor, body);
    return NextResponse.json(result);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requirePlatformAdmin();
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new Error('invalid_body');

    switch (body.action) {
      case 'add_admin':
        await addPlatformAdmin({
          actor,
          email: String(body.email ?? ''),
          note: typeof body.note === 'string' ? body.note : null,
        });
        return NextResponse.json({ ok: true });

      case 'remove_admin':
        await removePlatformAdmin({ actor, userId: String(body.userId ?? '') });
        return NextResponse.json({ ok: true });

      case 'allow':
        await addToAllowlist({
          actor,
          email: String(body.email ?? ''),
          note: typeof body.note === 'string' ? body.note : null,
          expiresAt:
            typeof body.expiresAt === 'string' && body.expiresAt
              ? body.expiresAt
              : null,
        });
        return NextResponse.json({ ok: true });

      case 'unallow':
        await removeFromAllowlist({ actor, email: String(body.email ?? '') });
        return NextResponse.json({ ok: true });

      default:
        throw new Error('invalid_action');
    }
  } catch (err) {
    return adminErrorResponse(err);
  }
}
