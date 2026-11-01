-- ============================================================
-- 083 — Reports packaging: who may customise, and how far back
--
-- Decision (2026-11-01, owner-approved):
--
--   Core    ready-made reports only · 90 days of history · no saved reports
--   Growth  + the builder, saved/shared reports, advanced metrics · 12 months
--   Scale   + unlimited history and unlimited saved reports
--
-- `reports` stays true for every plan — a report the client cannot see is not
-- a feature, it is a paywall on their own data. `reports_advanced` (already in
-- the catalogue, Core off / Growth + Scale on) becomes the *customization*
-- switch: it now gates the builder and saving, not just a few metrics.
--
-- Why a LIMIT and not another feature flag for history: a flag says "yes/no",
-- and the thing being sold here is a number of days. `null` means unlimited,
-- which is how the rest of `plans.limits` already expresses "no ceiling".
--
-- Written as JSONB merges so re-running is idempotent and a plan edited by the
-- super-admin panel keeps any other keys it carries.
-- ============================================================

UPDATE plans
SET features = COALESCE(features, '{}'::jsonb)
             || jsonb_build_object('reports', true)
             || jsonb_build_object(
                  'reports_advanced',
                  CASE WHEN code = 'core' THEN false ELSE true END
                ),
    limits   = COALESCE(limits, '{}'::jsonb)
             || jsonb_build_object(
                  'report_history_days',
                  CASE code
                    WHEN 'core'   THEN 90
                    WHEN 'growth' THEN 365
                    ELSE NULL
                  END
                )
             || jsonb_build_object(
                  'saved_reports',
                  CASE code
                    WHEN 'core'   THEN 0
                    WHEN 'growth' THEN 50
                    ELSE NULL
                  END
                )
WHERE code IN ('core', 'growth', 'scale');

-- A new install with no subscription row resolves to CORE features/limits
-- (src/lib/plans/entitlements.ts); these are the same numbers, kept here so a
-- reader of the schema does not have to guess what "entry tier" means.
COMMENT ON COLUMN plans.limits IS
  'Plan ceilings. null = unlimited. report_history_days: how far back a report may look; saved_reports: how many saved report definitions the account may keep (0 = saving not included).';
