import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { getAccountEntitlements } from '@/lib/plans/entitlements'

/**
 * The caller's plan + resolved entitlements.
 *
 * Read-only and RLS-scoped (any member may see what their account pays
 * for). The client uses it to hide what the plan does not include; every
 * write path re-checks server-side with `requireFeature` — this route is
 * for rendering, never for enforcement.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const entitlements = await getAccountEntitlements(supabase, accountId)

    return NextResponse.json({
      plan: entitlements.plan,
      status: entitlements.status,
      billing_interval: entitlements.billing_interval,
      started_at: entitlements.started_at,
      current_period_end: entitlements.current_period_end,
      trial_ends_at: entitlements.trial_ends_at,
      features: entitlements.features,
      limits: entitlements.limits,
      entitled: entitlements.entitled,
      is_default: entitlements.isDefault,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
