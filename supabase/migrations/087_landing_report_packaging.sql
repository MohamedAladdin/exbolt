-- ============================================================
-- 087 — Show the reports packaging on the landing plan cards
--
-- The landing card renders `plans.landing_features` (a curated list) and a few
-- `plans.limits` as numbers. The reports split added in 083 was only half
-- visible: Core advertised "reports" but not the CSV that comes with it, and
-- Growth/Scale advertised the advanced line without saying that every plan
-- also gets the ready-made reports.
--
-- This appends the missing codes where the feature is actually enabled, and
-- keeps the curated order by appending at the end (the card reads as
-- "everything else, plus…", which is the right story for the higher tiers).
-- Idempotent: re-running is a no-op.
-- ============================================================

UPDATE plans
SET landing_features =
  CASE
    WHEN landing_features IS NULL THEN jsonb_build_array('reports')
    WHEN landing_features ? 'reports' THEN landing_features
    ELSE landing_features || '["reports"]'::jsonb
  END
WHERE code IN ('core', 'growth', 'scale')
  AND (features->>'reports')::boolean IS TRUE;

-- `exports` is on every plan; Core is where saying it out loud matters, because
-- that bullet is the answer to "can I take the report to a meeting?".
UPDATE plans
SET landing_features =
  CASE
    WHEN landing_features ? 'exports' THEN landing_features
    ELSE landing_features || '["exports"]'::jsonb
  END
WHERE code = 'core'
  AND (features->>'exports')::boolean IS TRUE;

-- The two report ceilings must exist as numbers on the card. 083 wrote them;
-- this re-asserts them for a box where 083 ran before the labels shipped.
UPDATE plans
SET limits = COALESCE(limits, '{}'::jsonb)
           || jsonb_build_object(
                'report_history_days',
                CASE code WHEN 'core' THEN 90 WHEN 'growth' THEN 365 ELSE NULL END
              )
           || jsonb_build_object(
                'saved_reports',
                CASE code WHEN 'core' THEN 0 WHEN 'growth' THEN 50 ELSE NULL END
              )
WHERE code IN ('core', 'growth', 'scale');
