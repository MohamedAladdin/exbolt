// ============================================================
// Plan enforcement for API routes.
//
// The UI hides what a plan does not include, but hiding a nav item is not
// a control — a server route must refuse the work as well. Every
// billable capability therefore calls `requireFeature(...)` at the top of
// the handler and lets the typed error map to 402 (Payment Required),
// which is the honest status: the caller is allowed to ask, the plan is
// what is missing.
//
//   try {
//     const ctx = await requireFeature("broadcasts");
//     …
//   } catch (err) {
//     return toErrorResponse(err);   // 402 for PlanError
//   }
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getCurrentAccount,
  requireRole,
  type AccountContext,
} from '@/lib/auth/account';
import type { AccountRole } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  getAccountEntitlements,
  hasFeature,
  withinLimit,
  type Entitlements,
  type Feature,
  type LimitKey,
} from './entitlements';

/** Typed "your plan does not include this" failure. */
export class PlanError extends Error {
  readonly status = 402 as const;
  readonly code: string;
  readonly feature?: Feature;
  readonly limit?: LimitKey;

  constructor(
    message: string,
    options: { code?: string; feature?: Feature; limit?: LimitKey } = {},
  ) {
    super(message);
    this.name = 'PlanError';
    this.code = options.code ?? 'plan_feature_missing';
    this.feature = options.feature;
    this.limit = options.limit;
  }
}

/** Entitlements for the caller's account, resolved with the service role. */
export async function entitlementsFor(db: SupabaseClient, accountId: string) {
  return getAccountEntitlements(db, accountId);
}

export interface FeatureContext extends AccountContext {
  entitlements: Entitlements;
}

/**
 * Require a role AND a feature. Throws `ForbiddenError` for the role,
 * `PlanError` for the plan, so one `catch (toErrorResponse)` handles both.
 */
export async function requireFeature(
  feature: Feature,
  minRole: AccountRole = 'agent',
): Promise<FeatureContext> {
  const ctx = await requireRole(minRole);
  const entitlements = await entitlementsFor(supabaseAdmin(), ctx.accountId);
  if (!hasFeature(entitlements, feature)) {
    throw new PlanError(
      `This feature is not included in the ${entitlements.plan.name} plan.`,
      { code: 'plan_feature_missing', feature },
    );
  }
  return { ...ctx, entitlements };
}

/**
 * Require the running total to stay under a plan limit.
 *
 * `current` is the value BEFORE the operation (e.g. teammates already in
 * the account), so the check is "there is room for one more". A `null`
 * limit is unlimited.
 */
export async function requireWithinLimit(
  limit: LimitKey,
  current: number,
): Promise<Entitlements> {
  const ctx = await getCurrentAccount();
  const entitlements = await entitlementsFor(supabaseAdmin(), ctx.accountId);
  if (!withinLimit(entitlements, limit, current)) {
    throw new PlanError(
      `The ${entitlements.plan.name} plan allows ${entitlements.limits[limit] ?? 0} ${limit}.`,
      { code: 'plan_limit_reached', limit },
    );
  }
  return entitlements;
}
