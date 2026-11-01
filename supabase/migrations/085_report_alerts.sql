-- ============================================================
-- 085 — Report alerts
--
-- A scheduled report tells you what happened. An alert tells you when it is
-- wrong. One rule per metric of a saved report: "failed messages above 50",
-- "median response above 15", "delivered below 90".
--
-- Deliberately a threshold, not a query builder: every extra knob here is a
-- support ticket, and the metric already comes from the saved report's own
-- config — so the alert cannot measure something the report does not.
--
-- Firing is cooled down per rule (`cooldown_hours`, default a day): an alert
-- that fires on every hourly tick becomes noise and gets muted, which is the
-- same as not having it.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.report_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  saved_report_id UUID NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
  -- Must be one of the saved report's metrics; the API checks that against the
  -- report's own config before writing.
  metric          TEXT NOT NULL,
  comparator      TEXT NOT NULL CHECK (comparator IN ('gt', 'gte', 'lt', 'lte')),
  threshold       NUMERIC NOT NULL,
  cooldown_hours  INTEGER NOT NULL DEFAULT 24 CHECK (cooldown_hours BETWEEN 1 AND 168),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_fired_at   TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_value      NUMERIC,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_alerts_one_rule_per_metric UNIQUE (saved_report_id, metric)
);

CREATE INDEX IF NOT EXISTS idx_report_alerts_account
  ON public.report_alerts (account_id, is_active);

ALTER TABLE public.report_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_alerts_select ON public.report_alerts;
CREATE POLICY report_alerts_select ON public.report_alerts
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS report_alerts_write ON public.report_alerts;
CREATE POLICY report_alerts_write ON public.report_alerts
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- `notifications` only allowed the assignment type. An alert notification is
-- the same kind of row (title + body + a user), so the constraint is widened
-- rather than a second table invented for four columns.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'report_alert'));

-- ------------------------------------------------------------
-- due_report_alerts() — the rules a cron tick should evaluate.
--
-- "Due" is the cooldown, not the cadence: a rule is checked every tick (cheap,
-- it is one aggregate) but only *fires* once the cooldown has elapsed, so a
-- metric sitting above its threshold does not send a notification an hour.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.due_report_alerts()
RETURNS TABLE (
  alert_id        UUID,
  account_id      UUID,
  saved_report_id UUID,
  report_name     TEXT,
  report_config   JSONB,
  metric          TEXT,
  comparator      TEXT,
  threshold       NUMERIC,
  last_value      NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id,
         a.account_id,
         a.saved_report_id,
         r.name,
         r.config,
         a.metric,
         a.comparator,
         a.threshold,
         a.last_value
  FROM report_alerts a
  JOIN saved_reports r ON r.id = a.saved_report_id AND r.account_id = a.account_id
  WHERE a.is_active
    AND (a.last_checked_at IS NULL OR a.last_checked_at < NOW() - INTERVAL '55 minutes')
  ORDER BY a.account_id, a.id;
$$;

ALTER FUNCTION public.due_report_alerts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.due_report_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.due_report_alerts() TO service_role;

-- ------------------------------------------------------------
-- redeem_invitation — carried forward for `report_alerts`.
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
    UNION ALL SELECT 1 FROM report_alerts WHERE account_id = v_old_account_id
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
