-- ============================================================
-- 088 — member_profile: honest daily presence average + assigned count
--
-- Why: `onlinePerDay` divided the window's total by `p_days` (7/30/90), so a
-- member whose presence tracking started five days ago showed 52m/day on a
-- 30-day scope and 3h42m on a 7-day scope for the SAME 25h53m of real data.
-- The divisor is now the days actually covered by that member's sessions
-- inside the window (`trackedDays`), returned so the UI can name it.
--
-- Also returns `assignedConversations` — every conversation currently
-- assigned to the member, all statuses — so the profile can link straight
-- into the Inbox filtered by assignee (?assignee=<userId>).
-- ============================================================

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
  v_tracked_days INTEGER;
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

  -- Presence tracking is younger than the window: migration 080 shipped on
  -- 2026-10-30 and a member can join long after the account. Dividing by
  -- `p_days` invented a daily average over days that carry no data.
  SELECT LEAST(
           GREATEST(
             (date_trunc('day', v_now AT TIME ZONE v_tz)::date
              - date_trunc('day', greatest(v_start, COALESCE(min(s.started_at), v_now)) AT TIME ZONE v_tz)::date) + 1,
             1),
           p_days)
    INTO v_tracked_days
  FROM member_sessions s
  WHERE s.account_id = v_account AND s.user_id = p_user;

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
    'assignedConversations', (
      SELECT count(*) FROM conversations c
      WHERE c.account_id = v_account
        AND c.assigned_agent_id = p_user
    ),
    'trackedDays', v_tracked_days,
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
             ), 0) / GREATEST(v_tracked_days, 1)
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

-- ------------------------------------------------------------
-- member_conversation_ids — the conversations a member "took part in"
-- The member profile's replies card counts conversations through the same
-- `turns` definition, so the Inbox deep link (which passes the same window)
-- can filter to exactly that set instead of guessing from sender_id alone.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_conversation_ids(
  p_user UUID,
  p_days INTEGER DEFAULT 30,
  p_tz TEXT DEFAULT 'UTC'
) RETURNS UUID[]
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
  v_ids UUID[];
BEGIN
  SELECT p.account_id, p.account_role INTO v_account, v_role
  FROM profiles p WHERE p.user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'caller is not a member of an account' USING ERRCODE = '42501';
  END IF;

  IF p_days IS NULL OR p_days NOT IN (1, 7, 30, 90) THEN
    RAISE EXCEPTION 'p_days must be one of 1, 7, 30, 90' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.user_id = p_user AND p.account_id = v_account
  ) THEN
    RAISE EXCEPTION 'member not found in this account' USING ERRCODE = '22023';
  END IF;

  IF v_role NOT IN ('owner', 'admin') AND p_user <> auth.uid() THEN
    RAISE EXCEPTION 'only admins can read another member''s conversations'
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
    SELECT s.conversation_id, r.sender_id AS reply_agent
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
  )
  SELECT COALESCE(array_agg(DISTINCT t.conversation_id), '{}'::UUID[])
    INTO v_ids
  FROM turns t
  WHERE t.reply_agent = p_user;

  RETURN v_ids;
END;
$$;

ALTER FUNCTION public.member_conversation_ids(UUID, INTEGER, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.member_conversation_ids(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_conversation_ids(UUID, INTEGER, TEXT) TO authenticated;
