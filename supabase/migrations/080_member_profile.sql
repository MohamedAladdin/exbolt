-- ============================================================
-- 080 — team member profile: presence sessions + per-member KPIs
--
-- Why: `member_presence` is a single row per user (status + last_seen_at),
-- so "how many hours did this agent actually work today" is unanswerable —
-- the row is overwritten 30s at a time. The dashboard's `dashboard_overview`
-- also only counts replies and a median, per member, for the whole account.
--
-- This migration adds:
--   1. `member_sessions` — one row per uninterrupted online stretch, written
--      by `touch_presence` itself (no new client code, no new endpoint).
--      A gap of >2 minutes, or switching to 'away', closes the session.
--   2. `member_profile(user, days, tz)` — one round trip that returns the
--      member's identity plus replies, first-response median/p90/fastest,
--      conversations answered, unique contacts, open + resolved load,
--      online minutes (total and per day) and a daily series.
--
-- Privacy: the caller must be in the same account, and may only read a
-- colleague's numbers as admin+ — an agent sees their own profile and
-- nobody else's. Enforced here, not only in the UI.
--
-- No temp tables: the function is SECURITY DEFINER and must stay read-only,
-- so every aggregate is a CTE over `messages` (same shape as the `turns`
-- CTE in 059_dashboard_overview.sql).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.member_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Last heartbeat inside this session; a session only grows while beats
  -- keep arriving (2-minute grace on the next beat).
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when the member goes 'away' or the grace period lapses.
  ended_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_member_sessions_user_range
  ON public.member_sessions (account_id, user_id, started_at DESC);

ALTER TABLE public.member_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_sessions_select ON public.member_sessions;
CREATE POLICY member_sessions_select ON public.member_sessions
  FOR SELECT USING (is_account_member(account_id));
-- No client writes: `touch_presence` (SECURITY DEFINER) is the only writer.

-- ------------------------------------------------------------
-- touch_presence — same contract as 024, plus the session ledger.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_presence(
  p_status TEXT DEFAULT 'online'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_session_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status       = excluded.status,
        last_seen_at = now(),
        account_id   = excluded.account_id;

  IF p_status = 'online' THEN
    -- Continue the open session only when the previous beat is fresh;
    -- a laptop that slept for an hour starts a new stretch.
    SELECT id INTO v_session_id
    FROM member_sessions
    WHERE user_id = auth.uid()
      AND account_id = v_account_id
      AND ended_at IS NULL
      AND last_seen_at > now() - interval '2 minutes'
    ORDER BY last_seen_at DESC
    LIMIT 1;

    IF v_session_id IS NOT NULL THEN
      UPDATE member_sessions SET last_seen_at = now() WHERE id = v_session_id;
    ELSE
      -- Close a dangling session before opening a new one, so totals never
      -- overlap (a >2min beat gap would otherwise count twice).
      UPDATE member_sessions
         SET ended_at = last_seen_at
       WHERE user_id = auth.uid()
         AND account_id = v_account_id
         AND ended_at IS NULL;

      INSERT INTO member_sessions (user_id, account_id)
      VALUES (auth.uid(), v_account_id);
    END IF;
  ELSE
    UPDATE member_sessions
       SET last_seen_at = now(),
           ended_at = now()
     WHERE user_id = auth.uid()
       AND account_id = v_account_id
       AND ended_at IS NULL;
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- member_profile(p_user, p_days, p_tz)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_profile(
  p_user UUID,
  p_days INTEGER DEFAULT 30,
  p_tz TEXT DEFAULT 'UTC'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_role account_role_enum;
  v_tz TEXT := 'UTC';
  v_now TIMESTAMPTZ := now();
  v_start TIMESTAMPTZ;
  v_target INTEGER;
  v_member RECORD;
  v_kpis JSONB;
  v_daily JSONB;
BEGIN
  SELECT p.account_id, p.account_role INTO v_account, v_role
  FROM profiles p WHERE p.user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'caller is not a member of an account' USING ERRCODE = '42501';
  END IF;

  IF p_days IS NULL OR p_days NOT IN (1, 7, 30, 90) THEN
    RAISE EXCEPTION 'p_days must be one of 1, 7, 30, 90' USING ERRCODE = '22023';
  END IF;

  SELECT p.user_id, p.full_name, p.avatar_url, p.account_role, u.email
    INTO v_member
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.user_id
  WHERE p.user_id = p_user AND p.account_id = v_account;

  IF v_member.user_id IS NULL THEN
    RAISE EXCEPTION 'member not found in this account' USING ERRCODE = '22023';
  END IF;

  IF v_role NOT IN ('owner', 'admin') AND p_user <> auth.uid() THEN
    RAISE EXCEPTION 'only admins can read another member''s KPIs'
      USING ERRCODE = '42501';
  END IF;

  IF p_tz IS NOT NULL THEN
    BEGIN
      PERFORM v_now AT TIME ZONE p_tz;
      v_tz := p_tz;
    EXCEPTION WHEN invalid_parameter_value THEN
      v_tz := 'UTC';
    END;
  END IF;

  v_start := (date_trunc('day', v_now AT TIME ZONE v_tz)
              - make_interval(days => p_days - 1)) AT TIME ZONE v_tz;

  SELECT COALESCE(a.reply_target_minutes, 5) INTO v_target
  FROM accounts a WHERE a.id = v_account;

  WITH msgs AS (
    SELECT m.id, m.conversation_id, m.sender_type, m.status, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account
      AND m.created_at >= v_start - interval '1 day'
  ),
  streams AS (
    SELECT conversation_id, created_at,
           sender_type = 'customer' AS is_customer,
           lag(sender_type = 'customer') OVER (
             PARTITION BY conversation_id ORDER BY created_at, id
           ) AS prev_customer
    FROM msgs
    WHERE sender_type = 'customer'
       OR (sender_type = 'agent' AND status <> 'failed')
  ),
  turns AS (
    SELECT s.conversation_id,
           s.created_at AS asked_at,
           r.sender_id AS reply_agent,
           extract(epoch FROM r.created_at - s.created_at) / 60.0 AS minutes
    FROM streams s
    CROSS JOIN LATERAL (
      SELECT m2.sender_id, m2.created_at
      FROM messages m2
      WHERE m2.conversation_id = s.conversation_id
        AND m2.created_at > s.created_at
        AND m2.status <> 'failed'
        AND m2.sender_type = 'agent'
      ORDER BY m2.created_at, m2.id
      LIMIT 1
    ) r
    WHERE s.is_customer
      AND s.prev_customer IS NOT TRUE
      AND s.created_at >= v_start
  ),
  mine AS (
    SELECT * FROM turns WHERE reply_agent = p_user
  ),
  agg AS (
    SELECT
      count(*) AS replies,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS median_minutes,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY minutes) AS p90_minutes,
      min(minutes) AS fastest_minutes,
      count(*) FILTER (WHERE minutes <= v_target) AS within_target,
      count(DISTINCT conversation_id) AS conversations
    FROM mine
  )
  SELECT jsonb_build_object(
    'replies', a.replies,
    'medianMinutes', a.median_minutes,
    'p90Minutes', a.p90_minutes,
    'fastestMinutes', a.fastest_minutes,
    'withinTarget', a.within_target,
    'conversations', a.conversations,
    'contacts', (
      SELECT count(DISTINCT c.contact_id)
      FROM mine m JOIN conversations c ON c.id = m.conversation_id
    ),
    'openAssigned', (
      SELECT count(*) FROM conversations c
      WHERE c.account_id = v_account
        AND c.status <> 'closed'
        AND c.assigned_agent_id = p_user
    ),
    'resolved', (
      SELECT count(*) FROM conversations c
      WHERE c.account_id = v_account
        AND c.assigned_agent_id = p_user
        AND c.closed_at IS NOT NULL
        AND c.closed_at >= v_start
    ),
    'onlineMinutes', round((
      SELECT COALESCE(sum(
               extract(epoch FROM (
                 least(COALESCE(s.ended_at, s.last_seen_at), v_now)
                 - greatest(s.started_at, v_start)
               )) / 60.0
             ), 0)
      FROM member_sessions s
      WHERE s.account_id = v_account
        AND s.user_id = p_user
        AND s.started_at < v_now
        AND COALESCE(s.ended_at, s.last_seen_at) > v_start
    )),
    'onlinePerDay', round((
      SELECT COALESCE(sum(
               extract(epoch FROM (
                 least(COALESCE(s.ended_at, s.last_seen_at), v_now)
                 - greatest(s.started_at, v_start)
               )) / 60.0
             ), 0) / GREATEST(p_days, 1)
      FROM member_sessions s
      WHERE s.account_id = v_account
        AND s.user_id = p_user
        AND s.started_at < v_now
        AND COALESCE(s.ended_at, s.last_seen_at) > v_start
    )),
    'replyTarget', v_target,
    'lastActivityAt', (
      SELECT max(m.created_at)
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = v_account AND m.sender_id = p_user
    )
  ) INTO v_kpis
  FROM agg a;

  -- Daily series: replies per local day + online minutes clipped to that
  -- day's boundaries (so a session crossing midnight is split correctly).
  WITH msgs AS (
    SELECT m.id, m.conversation_id, m.sender_type, m.status, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account
      AND m.created_at >= v_start - interval '1 day'
  ),
  streams AS (
    SELECT conversation_id, created_at,
           sender_type = 'customer' AS is_customer,
           lag(sender_type = 'customer') OVER (
             PARTITION BY conversation_id ORDER BY created_at, id
           ) AS prev_customer
    FROM msgs
    WHERE sender_type = 'customer'
       OR (sender_type = 'agent' AND status <> 'failed')
  ),
  turns AS (
    SELECT s.created_at AS asked_at, r.sender_id AS reply_agent
    FROM streams s
    CROSS JOIN LATERAL (
      SELECT m2.sender_id, m2.created_at
      FROM messages m2
      WHERE m2.conversation_id = s.conversation_id
        AND m2.created_at > s.created_at
        AND m2.status <> 'failed'
        AND m2.sender_type = 'agent'
      ORDER BY m2.created_at, m2.id
      LIMIT 1
    ) r
    WHERE s.is_customer
      AND s.prev_customer IS NOT TRUE
      AND s.created_at >= v_start
  ),
  days AS (
    SELECT d::date AS day,
           (d AT TIME ZONE v_tz) AS day_start,
           ((d + interval '1 day') AT TIME ZONE v_tz) AS day_end
    FROM generate_series(
      date_trunc('day', v_start AT TIME ZONE v_tz),
      date_trunc('day', v_now AT TIME ZONE v_tz),
      interval '1 day'
    ) d
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', to_char(days.day, 'YYYY-MM-DD'),
           'replies', (
             SELECT count(*) FROM turns t
             WHERE t.reply_agent = p_user
               AND t.asked_at >= days.day_start
               AND t.asked_at < days.day_end
           ),
           'onlineMinutes', (
             SELECT COALESCE(round(sum(
               extract(epoch FROM (
                 least(COALESCE(s.ended_at, s.last_seen_at), days.day_end)
                 - greatest(s.started_at, days.day_start)
               )) / 60.0
             )), 0)
             FROM member_sessions s
             WHERE s.account_id = v_account
               AND s.user_id = p_user
               AND s.started_at < days.day_end
               AND COALESCE(s.ended_at, s.last_seen_at) > days.day_start
           )
         ) ORDER BY days.day), '[]'::jsonb)
    INTO v_daily
  FROM days;

  RETURN jsonb_build_object(
    'member', jsonb_build_object(
      'userId', v_member.user_id,
      'name', v_member.full_name,
      'email', v_member.email,
      'avatarUrl', v_member.avatar_url,
      'role', v_member.account_role,
      'presence', (SELECT mp.status FROM member_presence mp
                    WHERE mp.user_id = p_user AND mp.account_id = v_account),
      'lastSeenAt', (SELECT mp.last_seen_at FROM member_presence mp
                      WHERE mp.user_id = p_user AND mp.account_id = v_account)
    ),
    'range', jsonb_build_object('days', p_days, 'start', v_start, 'timezone', v_tz),
    'kpis', v_kpis,
    'daily', v_daily
  );
END;
$$;

ALTER FUNCTION public.member_profile(UUID, INTEGER, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.member_profile(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_profile(UUID, INTEGER, TEXT) TO authenticated;
