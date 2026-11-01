-- ============================================================
-- 084 — Scheduled report delivery
--
-- A report you have to remember to open is a report that stops being read by
-- week three. This migration gives a saved report a schedule: weekly or
-- monthly, at a given hour in the account's timezone, mailed to a list of
-- recipients as CSV plus a printable page.
--
-- Deliberately *not* a cron expression: a manager asks for "every Monday at
-- 8", not for `0 8 * * 1`, and every extra knob here is a support ticket.
--
-- Delivery runs from `/api/reports/cron` (guarded by the existing
-- AUTOMATION_CRON_SECRET convention), which reads `due_report_schedules()` and
-- then calls `_run_report(account, config)` — the account-parameterised
-- runner that exists exactly for this path.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- One schedule per saved report: two cadences for one definition is a
  -- duplicate nobody asked for.
  saved_report_id UUID NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
  cadence         TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  -- 0 = Sunday … 6 = Saturday (Postgres `dow`), weekly only.
  weekday         INTEGER CHECK (weekday BETWEEN 0 AND 6),
  -- 1–28 on purpose: a 29–31 schedule would skip February silently.
  day_of_month    INTEGER CHECK (day_of_month BETWEEN 1 AND 28),
  hour            INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  time_zone       TEXT NOT NULL DEFAULT 'Africa/Cairo',
  recipients      TEXT[] NOT NULL DEFAULT '{}',
  format          TEXT NOT NULL DEFAULT 'csv' CHECK (format IN ('csv', 'html')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent_at    TIMESTAMPTZ,
  -- Every attempt, successful or not. Without it a failing schedule is due on
  -- every tick (the cron runs every 10 minutes) and a dry-run install would
  -- retry forever; with it, one attempt per period is the rule.
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_schedules_shape CHECK (
    (cadence = 'weekly'  AND weekday IS NOT NULL AND day_of_month IS NULL)
    OR (cadence = 'monthly' AND day_of_month IS NOT NULL AND weekday IS NULL)
  ),
  CONSTRAINT report_schedules_recipients_present CHECK (cardinality(recipients) > 0),
  CONSTRAINT report_schedules_unique_report UNIQUE (saved_report_id)
);

-- Re-runs are safe: CREATE TABLE IF NOT EXISTS skips the table, so a column
-- added after the first apply needs its own idempotent ALTER.
ALTER TABLE public.report_schedules
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_report_schedules_account
  ON public.report_schedules (account_id, is_active);

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_schedules_select ON public.report_schedules;
CREATE POLICY report_schedules_select ON public.report_schedules
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS report_schedules_write ON public.report_schedules;
CREATE POLICY report_schedules_write ON public.report_schedules
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- due_report_schedules() — what the cron tick should send right now.
--
-- The comparison is done on the account's local clock: "Monday 08:00" means
-- the clinic's Monday, not UTC's. The grace window is what makes an hourly
-- cron idempotent — a schedule is due once `hour` is reached on its day and
-- not again until six (weekly) or twenty-seven (monthly) days have passed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.due_report_schedules(p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS TABLE (
  schedule_id      UUID,
  account_id       UUID,
  saved_report_id  UUID,
  report_name      TEXT,
  report_config    JSONB,
  recipients       TEXT[],
  format           TEXT,
  time_zone        TEXT,
  cadence          TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id,
         s.account_id,
         s.saved_report_id,
         r.name,
         r.config,
         s.recipients,
         s.format,
         s.time_zone,
         s.cadence
  FROM report_schedules s
  JOIN saved_reports r ON r.id = s.saved_report_id AND r.account_id = s.account_id
  WHERE s.is_active
    -- local hour reached (>= so a late tick still sends today)
    AND EXTRACT(HOUR FROM (p_now AT TIME ZONE s.time_zone)) >= s.hour
    AND (
      (s.cadence = 'weekly'
        AND EXTRACT(DOW FROM (p_now AT TIME ZONE s.time_zone))::INTEGER = s.weekday)
      OR (s.cadence = 'monthly'
        AND EXTRACT(DAY FROM (p_now AT TIME ZONE s.time_zone))::INTEGER = s.day_of_month)
    )
    AND (
      COALESCE(s.last_sent_at, s.last_attempt_at) IS NULL
      OR COALESCE(s.last_sent_at, s.last_attempt_at) < p_now - CASE s.cadence
        WHEN 'weekly'  THEN INTERVAL '6 days'
        ELSE INTERVAL '27 days'
      END
    )
  ORDER BY s.account_id, s.id;
$$;

ALTER FUNCTION public.due_report_schedules(TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.due_report_schedules(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.due_report_schedules(TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.due_report_schedules(TIMESTAMPTZ) IS
  'Schedules whose local delivery hour has arrived and whose period has not already been sent. Service role only.';

-- ------------------------------------------------------------
-- redeem_invitation — carried forward again for `report_schedules`.
--
-- The same rule as every other account-scoped table: joining another account
-- with a schedule defined is refused, because a schedule is domain data (it
-- names a report and an audience). The migration test enforces this list.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM channel_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM account_subscriptions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM account_grants WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM invoices WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM outbound_emails WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM account_requests WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM saved_reports WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM report_schedules WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
