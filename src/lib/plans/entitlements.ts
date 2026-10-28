/**
 * Plan entitlements — what an account is allowed to use.
 *
 * The catalogue itself lives in the database (`plans.features`,
 * `plans.limits`, migration 063) so a super-admin panel can change pricing
 * and packaging without a deploy. This module owns the *vocabulary* (the
 * feature codes) and the resolution rules; it never hard-codes prices.
 *
 * Resolution order for one account:
 *   1. its `account_subscriptions` row (plan + status + overrides),
 *   2. no row → CORE features with `trial` status (a fresh account in
 *      evaluation needs no extra write at signup),
 *   3. `feature_overrides` / `limit_overrides` are applied last, so a
 *      client who bought one capability à la carte gets it without us
 *      inventing a plan for them.
 *
 * A non-entitling status (canceled / suspended) turns everything off
 * except reading the plan page — the data is theirs, the product is not.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const FEATURES = [
  'inbox',
  'contacts',
  'pipelines',
  'broadcasts',
  'automations',
  'ai_suggest',
  'ai_agent',
  'ai_knowledge',
  'flows',
  'reports',
  'reports_advanced',
  'exports',
  'multi_channel',
  'integrations',
  'api',
  'webhooks',
  'team_roles',
  'branches',
  // Accountability trail: CORE off, GROWTH + SCALE on (migration 071).
  'audit_log',
] as const;

export type Feature = (typeof FEATURES)[number];

export const LIMITS = [
  'team_members',
  'broadcast_monthly',
  'channels',
  'ai_agents',
] as const;

export type LimitKey = (typeof LIMITS)[number];

/** `null` on a limit means unlimited. */
export type Limits = Partial<Record<LimitKey, number | null>>;

export type SubscriptionStatus =
  'trial' | 'active' | 'past_due' | 'canceled' | 'suspended';

export interface PlanSummary {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  tagline: string | null;
  price_monthly_usd: number;
  price_annual_usd: number | null;
  sort_order: number;
}

export interface Entitlements {
  plan: PlanSummary;
  status: SubscriptionStatus;
  billing_interval: 'monthly' | 'annual';
  current_period_end: string | null;
  trial_ends_at: string | null;
  /** Feature switches after overrides. */
  features: Record<Feature, boolean>;
  /** Limits after overrides; `null` = unlimited. */
  limits: Limits;
  /** True when the account may use the product at all. */
  entitled: boolean;
  /** True when the subscription row was invented (no row in the DB). */
  isDefault: boolean;
}

/** Used when the account has no subscription row and the catalogue is unreadable. */
export const FALLBACK_PLAN: PlanSummary = {
  id: '00000000-0000-0000-0000-000000000000',
  code: 'core',
  name: 'Core',
  name_ar: 'الأساسية',
  tagline: null,
  price_monthly_usd: 65,
  price_annual_usd: 715,
  sort_order: 1,
};

/**
 * CORE defaults, mirroring the seeded row. Only used when there is no
 * subscription row at all, so a brand-new install still behaves like the
 * entry tier instead of locking the user out of their own inbox.
 */
export const DEFAULT_FEATURES: Record<Feature, boolean> = {
  inbox: true,
  contacts: true,
  pipelines: true,
  broadcasts: true,
  automations: true,
  ai_suggest: true,
  ai_agent: false,
  ai_knowledge: false,
  flows: false,
  reports: true,
  reports_advanced: false,
  exports: true,
  multi_channel: false,
  integrations: false,
  api: false,
  webhooks: false,
  team_roles: false,
  branches: false,
  audit_log: false,
};

export const DEFAULT_LIMITS: Limits = {
  team_members: 5,
  broadcast_monthly: 5000,
  channels: 1,
  ai_agents: 0,
};

const ENTITLING: readonly SubscriptionStatus[] = [
  'trial',
  'active',
  'past_due',
];

/** Normalise a `plans.features` JSONB map onto the full feature set. */
export function featuresFromPlan(raw: unknown): Record<Feature, boolean> {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_FEATURES };
  for (const feature of FEATURES) {
    const value = source[feature];
    if (typeof value === 'boolean') out[feature] = value;
  }
  return out;
}

/** Normalise `plans.limits` JSONB; an explicit `null` means unlimited. */
export function limitsFromPlan(
  raw: unknown,
  base: Limits = DEFAULT_LIMITS
): Limits {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out: Limits = { ...base };
  for (const key of LIMITS) {
    if (!(key in source)) continue;
    const value = source[key];
    if (value === null) out[key] = null;
    else if (typeof value === 'number' && Number.isFinite(value))
      out[key] = value;
  }
  return out;
}

/** Apply per-account overrides on top of a resolved plan. */
export function applyOverrides(
  features: Record<Feature, boolean>,
  limits: Limits,
  featureOverrides: unknown,
  limitOverrides: unknown
): { features: Record<Feature, boolean>; limits: Limits } {
  const fOver = (featureOverrides ?? {}) as Record<string, unknown>;
  const nextFeatures = { ...features };
  for (const feature of FEATURES) {
    if (typeof fOver[feature] === 'boolean')
      nextFeatures[feature] = fOver[feature] as boolean;
  }
  return {
    features: nextFeatures,
    limits: limitsFromPlan(limitOverrides, limits),
  };
}

/**
 * Apply active grants (migration 065) on top of plan + overrides.
 *
 * A grant is a gift with an expiry, so it wins over an override: if the
 * operator gave an account `ai_agent` for a month, revoking it in the
 * subscription overrides must not silently take it away. Expired or
 * revoked grants are filtered before they get here.
 */
export function applyGrants(
  features: Record<Feature, boolean>,
  limits: Limits,
  grants: readonly { kind: string; key: string | null; value: unknown }[]
): { features: Record<Feature, boolean>; limits: Limits } {
  const nextFeatures = { ...features };
  const nextLimits: Limits = { ...limits };

  for (const grant of grants) {
    if (!grant.key) continue;
    if (grant.kind === 'feature' && typeof grant.value === 'boolean') {
      if ((FEATURES as readonly string[]).includes(grant.key)) {
        nextFeatures[grant.key as Feature] = grant.value;
      }
    }
    if (
      grant.kind === 'limit' &&
      (LIMITS as readonly string[]).includes(grant.key)
    ) {
      const value = grant.value;
      if (value === null) nextLimits[grant.key as LimitKey] = null;
      else if (typeof value === 'number' && Number.isFinite(value)) {
        nextLimits[grant.key as LimitKey] = value;
      }
    }
  }

  return { features: nextFeatures, limits: nextLimits };
}

export function hasFeature(
  ent: Entitlements | null | undefined,
  feature: Feature
): boolean {
  if (!ent) return false;
  if (!ent.entitled) return false;
  return ent.features[feature] !== false;
}

/** `null` limit = unlimited; a missing limit = 0 (deny) rather than Infinity. */
export function withinLimit(
  ent: Entitlements | null | undefined,
  key: LimitKey,
  current: number
): boolean {
  if (!ent || !ent.entitled) return false;
  const limit = ent.limits[key];
  if (limit === null) return true;
  if (typeof limit !== 'number') return false;
  return current < limit;
}

interface SubscriptionRow {
  status: SubscriptionStatus;
  billing_interval: 'monthly' | 'annual';
  current_period_end: string | null;
  trial_ends_at: string | null;
  feature_overrides: unknown;
  limit_overrides: unknown;
  plan?: {
    id: string;
    code: string;
    name: string;
    name_ar: string | null;
    tagline: string | null;
    price_monthly_usd: number | string;
    price_annual_usd: number | string | null;
    sort_order: number;
    features: unknown;
    limits: unknown;
  } | null;
}

function toPlanSummary(
  plan: NonNullable<SubscriptionRow['plan']>
): PlanSummary {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    name_ar: plan.name_ar,
    tagline: plan.tagline,
    price_monthly_usd: Number(plan.price_monthly_usd ?? 0),
    price_annual_usd:
      plan.price_annual_usd === null ? null : Number(plan.price_annual_usd),
    sort_order: plan.sort_order ?? 0,
  };
}

interface GrantRow {
  kind: string;
  key: string | null;
  value: unknown;
}

/**
 * Active (non-revoked, unexpired) grants for one account. Called with the
 * caller's client: RLS lets a member read their own grants, and the
 * service role (guards, webhooks) reads any.
 */
async function loadActiveGrants(
  db: SupabaseClient,
  accountId: string
): Promise<GrantRow[]> {
  const { data, error } = await db
    .from('account_grants')
    .select('kind, key, value, expires_at, revoked_at')
    .eq('account_id', accountId);

  if (error) {
    // A pre-065 schema has no such table — degrade to "no grants" rather
    // than taking the whole app's entitlements down with it.
    if (!/does not exist|schema cache/i.test(error.message)) {
      console.error('[plans] grants lookup failed:', error.message);
    }
    return [];
  }

  const now = Date.now();
  return (
    (data ?? []) as (GrantRow & {
      expires_at: string | null;
      revoked_at: string | null;
    })[]
  )
    .filter((grant) => !grant.revoked_at)
    .filter(
      (grant) => !grant.expires_at || new Date(grant.expires_at).getTime() > now
    )
    .map(({ kind, key, value }) => ({ kind, key, value }));
}

/**
 * Resolve the entitlements for one account.
 *
 * Reads `account_subscriptions` with the plan embedded. The caller chooses
 * the client: RLS lets a member read their own row, and the service role
 * (webhooks, guards) can read any.
 */
export async function getAccountEntitlements(
  db: SupabaseClient,
  accountId: string
): Promise<Entitlements> {
  const { data, error } = await db
    .from('account_subscriptions')
    .select(
      'status, billing_interval, current_period_end, trial_ends_at, feature_overrides, limit_overrides, plan:plans(id, code, name, name_ar, tagline, price_monthly_usd, price_annual_usd, sort_order, features, limits)'
    )
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    console.error('[plans] subscription lookup failed:', error.message);
  }

  const row = (data as SubscriptionRow | null) ?? null;
  const grants = await loadActiveGrants(db, accountId);

  if (!row) {
    const granted = applyGrants(
      { ...DEFAULT_FEATURES },
      { ...DEFAULT_LIMITS },
      grants
    );
    return {
      plan: FALLBACK_PLAN,
      status: 'trial',
      billing_interval: 'monthly',
      current_period_end: null,
      trial_ends_at: null,
      features: granted.features,
      limits: granted.limits,
      entitled: true,
      isDefault: true,
    };
  }

  const plan = row.plan ? toPlanSummary(row.plan) : FALLBACK_PLAN;
  const overridden = applyOverrides(
    featuresFromPlan(row.plan?.features),
    limitsFromPlan(row.plan?.limits),
    row.feature_overrides,
    row.limit_overrides
  );
  const { features, limits } = applyGrants(
    overridden.features,
    overridden.limits,
    grants
  );

  return {
    plan,
    status: row.status,
    billing_interval: row.billing_interval,
    current_period_end: row.current_period_end,
    trial_ends_at: row.trial_ends_at,
    features,
    limits,
    entitled: ENTITLING.includes(row.status),
    isDefault: false,
  };
}
