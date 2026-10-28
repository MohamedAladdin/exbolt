-- ============================================================
-- 071_activity_log_retention_and_feature
--
-- Three things the activity log needs before it can be sold:
--
--   1. a plan feature (`audit_log`) so the tab and the API can be
--      gated per plan — CORE off, GROWTH + SCALE on;
--   2. an index that serves the retention delete (the read indexes
--      are keyed by account, the sweep is keyed by time);
--   3. `purge_account_activity(days)` — the function a daily cron
--      calls. Without it the table grows forever: every settings
--      save, every template edit, every assignment is a new row.
--
-- Idempotent: safe to re-run (the feature merge only fills a missing
-- key, the index uses IF NOT EXISTS, the function is CREATE OR REPLACE).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Plan feature
--
-- Written as a full-table UPDATE with a `NOT features ?` guard so a
-- re-run never overwrites an operator's deliberate choice, and a plan
-- code added later defaults to OFF (the safe side: the trail is an
-- upsell, not something a Core tenant silently gets).
--
-- Mirrors `FEATURES` / `DEFAULT_FEATURES` in src/lib/plans/entitlements.ts.
-- ------------------------------------------------------------
UPDATE plans
   SET features = features || jsonb_build_object(
         'audit_log',
         code IN ('growth', 'scale')
       )
 WHERE NOT features ? 'audit_log';

-- ------------------------------------------------------------
-- 2. Retention index
--
-- Reads are always "this account, newest first" and use
-- idx_account_activity_account_time. Retention is "everything older
-- than the cutoff, for every account", which that index cannot serve:
-- without a leading account_id the planner would seq-scan. A plain
-- btree on created_at turns the purge into a range scan over exactly
-- the doomed rows.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_account_activity_created_at
  ON account_activity_log (created_at);

-- ------------------------------------------------------------
-- 3. The purge
--
-- Deletes in batches so one statement never holds a long lock on a
-- busy tenant's rows, and caps the batch size at 20k.
--
-- Called from the cron route with the service role only: a tenant may
-- not run maintenance on the table (and RLS would block it anyway,
-- since the log has no delete policy for anyone).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_account_activity(
  p_retention_days INTEGER DEFAULT 180,
  p_batch_size     INTEGER DEFAULT 20000
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff  TIMESTAMPTZ;
  v_deleted INTEGER := 0;
  v_batch   INTEGER;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 30 THEN
    RAISE EXCEPTION 'retention must be at least 30 days'
      USING ERRCODE = '22023';
  END IF;
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'batch size must be positive'
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := NOW() - make_interval(days => p_retention_days);

  LOOP
    WITH doomed AS (
      SELECT ctid
        FROM account_activity_log
       WHERE created_at < v_cutoff
       LIMIT p_batch_size
    )
    DELETE FROM account_activity_log AS l
     USING doomed
     WHERE l.ctid = doomed.ctid;

    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_deleted := v_deleted + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;

  RETURN v_deleted;
END;
$$;

ALTER FUNCTION public.purge_account_activity(INTEGER, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.purge_account_activity(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_account_activity(INTEGER, INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.purge_account_activity(INTEGER, INTEGER) IS
  'Retention sweep for account_activity_log: deletes rows older than p_retention_days (default 180) in batches. Called by the daily cron route with the service role.';
