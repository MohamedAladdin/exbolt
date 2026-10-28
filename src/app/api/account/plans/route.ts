import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

/**
 * Active plans a tenant admin can ask to move to. Read-only; the actual plan
 * change always happens in the super-admin panel.
 */
export async function GET() {
  try {
    const { supabase } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('plans')
      .select(
        'id, code, name, name_ar, tagline, price_monthly_usd, price_annual_usd, features, limits, sort_order'
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[account/plans] read failed:', error.message);
      return NextResponse.json({ error: 'plans_unavailable' }, { status: 500 });
    }

    return NextResponse.json({ plans: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
