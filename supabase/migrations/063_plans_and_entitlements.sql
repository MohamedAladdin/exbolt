-- ============================================================
-- 063_plans_and_entitlements
--
-- The commercial model quoted to Hemocure (EXC / HMC / 2026-10):
-- three annual/monthly tiers — CORE, GROWTH, SCALE — each unlocking a
-- defined set of capabilities and numeric limits.
--
-- This migration makes the plan a first-class, data-driven thing:
--
--   plans                 — the catalogue (features + limits as JSONB, so a
--                           super-admin panel can edit them later without a
--                           deploy; code only reads them).
--   account_subscriptions — one row per account: which plan, billing status,
--                           and per-account overrides (a client who bought
--                           "AI Agent" à la carte gets it switched on here
--                           without inventing a plan for them).
--
-- No subscription row = a fresh account still in evaluation; the app
-- resolves that to the CORE feature set with `trial` status (see
-- src/lib/plans/entitlements.ts), so signup needs no extra write.
--
-- Writes are service-role only: the subscription is billing state. A
-- client admin may READ their own plan (to see what they pay for), never
-- change it — that is the super-admin panel's job.
--
-- Idempotent: safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  name_ar           TEXT,
  tagline           TEXT,
  -- USD, matching the offer (prices are quoted and invoiced in USD).
  price_monthly_usd NUMERIC(10, 2) NOT NULL,
  price_annual_usd  NUMERIC(10, 2),
  -- { "inbox": true, "ai_agent": false, … } — feature codes from
  -- src/lib/plans/features.ts. Missing key = feature off.
  features          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { "team_members": 5, "broadcast_monthly": 5000, … } — null = unlimited.
  limits            JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON plans;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- The catalogue is not a secret: any signed-in user may read it (the plan
-- page shows what the next tier includes).
DROP POLICY IF EXISTS plans_select ON plans;
CREATE POLICY plans_select ON plans FOR SELECT TO authenticated USING (TRUE);

-- Writes intentionally have NO policy: only the service role (super-admin
-- API) can change pricing or features.

CREATE TABLE IF NOT EXISTS account_subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id            UUID REFERENCES plans(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'trial'
                       CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'suspended')),
  billing_interval   TEXT NOT NULL DEFAULT 'monthly'
                       CHECK (billing_interval IN ('monthly', 'annual')),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  trial_ends_at      TIMESTAMPTZ,
  -- Per-account feature switches, layered on top of the plan:
  --   { "ai_agent": true }   → granted even though the plan lacks it
  --   { "api": false }       → revoked even though the plan grants it
  feature_overrides  JSONB NOT NULL DEFAULT '{}'::jsonb,
  limit_overrides    JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_subscriptions_plan
  ON account_subscriptions (plan_id);

DROP TRIGGER IF EXISTS set_updated_at ON account_subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE account_subscriptions ENABLE ROW LEVEL SECURITY;

-- Read-only for members: a client must see their plan, never rewrite it.
DROP POLICY IF EXISTS account_subscriptions_select ON account_subscriptions;
CREATE POLICY account_subscriptions_select ON account_subscriptions
  FOR SELECT USING (is_account_member(account_id));

-- ---- plan catalogue (from the Hemocure offer) -----------------
-- CORE — the clinic that is starting to get organised.
INSERT INTO plans (code, name, name_ar, tagline, price_monthly_usd, price_annual_usd, sort_order, features, limits)
VALUES (
  'core',
  'Core',
  'الأساسية',
  'For a single clinic getting organised',
  65.00,
  715.00,
  1,
  jsonb_build_object(
    'inbox', true,
    'contacts', true,
    'pipelines', true,
    'broadcasts', true,
    'automations', true,          -- ready-made reminder templates
    'ai_suggest', true,           -- AI draft suggestions only
    'reports', true,
    'exports', true,
    'multi_channel', false,       -- WhatsApp only
    'ai_agent', false,
    'ai_knowledge', false,
    'flows', false,
    'integrations', false,
    'api', false,
    'webhooks', false,
    'team_roles', false,
    'branches', false,
    'reports_advanced', false
  ),
  jsonb_build_object(
    'team_members', 5,
    'broadcast_monthly', 5000,
    'channels', 1,
    'ai_agents', 0
  )
)
ON CONFLICT (code) DO NOTHING;

-- GROWTH — messages turned into bookings.
INSERT INTO plans (code, name, name_ar, tagline, price_monthly_usd, price_annual_usd, sort_order, features, limits)
VALUES (
  'growth',
  'Growth',
  'النمو',
  'Multi-specialty clinic with a sales and follow-up team',
  129.00,
  1419.00,
  2,
  jsonb_build_object(
    'inbox', true,
    'contacts', true,
    'pipelines', true,
    'broadcasts', true,
    'automations', true,
    'ai_suggest', true,
    'reports', true,
    'exports', true,
    'multi_channel', true,        -- 2 WhatsApp + Instagram + Facebook
    'ai_agent', true,
    'ai_knowledge', true,
    'flows', true,
    'integrations', true,
    'team_roles', true,
    'reports_advanced', true,
    'api', false,
    'webhooks', false,
    'branches', false
  ),
  jsonb_build_object(
    'team_members', 15,
    'broadcast_monthly', 25000,
    'channels', 4,
    'ai_agents', 1
  )
)
ON CONFLICT (code) DO NOTHING;

-- SCALE — a network with branches.
INSERT INTO plans (code, name, name_ar, tagline, price_monthly_usd, price_annual_usd, sort_order, features, limits)
VALUES (
  'scale',
  'Scale',
  'التوسع',
  'Clinic group or multi-branch centre',
  229.00,
  2519.00,
  3,
  jsonb_build_object(
    'inbox', true,
    'contacts', true,
    'pipelines', true,
    'broadcasts', true,
    'automations', true,
    'ai_suggest', true,
    'reports', true,
    'exports', true,
    'multi_channel', true,
    'ai_agent', true,
    'ai_knowledge', true,
    'flows', true,
    'integrations', true,
    'team_roles', true,
    'reports_advanced', true,
    'api', true,
    'webhooks', true,
    'branches', true
  ),
  jsonb_build_object(
    'team_members', NULL,          -- unlimited
    'broadcast_monthly', NULL,     -- unlimited
    'channels', NULL,              -- unlimited
    'ai_agents', 5
  )
)
ON CONFLICT (code) DO NOTHING;
