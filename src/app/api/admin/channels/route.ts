/**
 * /api/admin/channels — connection control across every tenant.
 *
 *   POST { action: "enable" | "disable", channel, id }
 *   POST { action: "revoke", channel, id }   → deletes the stored token
 */

import { NextResponse } from 'next/server';

import { requirePlatformAdmin, adminErrorResponse } from '@/lib/admin/auth';
import { deleteChannel, setChannelActive } from '@/lib/admin/mutations';

const CHANNELS = new Set(['whatsapp', 'messenger', 'instagram']);

export async function POST(request: Request) {
  try {
    const actor = await requirePlatformAdmin();
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new Error('invalid_body');

    const channel = String(body.channel ?? '') as
      'whatsapp' | 'messenger' | 'instagram';
    if (!CHANNELS.has(channel)) throw new Error('invalid_channel');
    const id = String(body.id ?? '');
    if (!id) throw new Error('invalid_channel_id');

    if (body.action === 'enable' || body.action === 'disable') {
      const result = await setChannelActive({
        actor,
        channel,
        id,
        active: body.action === 'enable',
      });
      return NextResponse.json(result);
    }
    if (body.action === 'revoke') {
      const result = await deleteChannel({ actor, channel, id });
      return NextResponse.json(result);
    }

    throw new Error('invalid_action');
  } catch (err) {
    return adminErrorResponse(err);
  }
}
