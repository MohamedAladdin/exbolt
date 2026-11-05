-- ============================================================
-- 107 — PUSH OUTBOX + EVENT TRIGGERS · phase P3
--
-- The transport (105) and the preferences (106) exist; nothing produced an
-- out-of-app alert yet. This migration is the producer side: one row per
-- (event, recipient) inside the same transaction as the event itself, then a
-- server-side drain sends it.
--
-- Why an outbox and not a direct `fetch` to the push service from the trigger:
--   1. A push API call inside a trigger would hold the customer's message
--      transaction open on a third party's latency. A WhatsApp message must
--      never wait for FCM.
--   2. A failed send must survive the crash of the request that caused it.
--      The row is the durable record; delivery can be retried.
--   3. Ownership/preferences can change between the event and the send. The
--      row carries the recipient, and the drain re-checks.
--
-- Two layers, deliberately:
--   * the trigger is exception-guarded — a push bug must never reject a
--     customer message — and its body is only an INSERT … ON CONFLICT DO NOTHING;
--   * `reconcile_push_outbox()` backfills anything a swallowed exception lost,
--     and reports the count. A non-zero `reconciled` is a bug signal, not a
--     silent repair.
--
-- Dedupe: `dedupe_key` is one row per (conversation, user, 60-second bucket),
-- so a customer message and the handoff it triggers in the same webhook become
-- ONE alert (severity wins: ai_handoff > conversation_assigned > customer_message).
-- `event_key` records the source event, so the reconciler can tell "this event
-- has no outbox row" without re-deriving the bucket.
--
-- Idempotent: safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES public.notifications(id) ON DELETE CASCADE,
  -- customer_message | conversation_assigned | ai_handoff | report_alert
  kind TEXT NOT NULL CHECK (
    kind IN ('customer_message', 'conversation_assigned', 'ai_handoff', 'report_alert')
  ),
  -- 1 customer_message · 2 conversation_assigned · 3 ai_handoff · 4 report_alert.
  -- Only used to pick the surviving row when two producers hit one bucket.
  severity SMALLINT NOT NULL DEFAULT 1,
  contact_name TEXT,
  -- Raw, untruncated preview text; the sender applies the user's privacy level
  -- and the payload size cap at send time.
  preview TEXT,
  url TEXT,
  -- Display/coalescing identity (see header). UNIQUE = at-most-once enqueue.
  dedupe_key TEXT NOT NULL,
  -- Source event identity: 'msg:<message_id>:<user_id>' or 'notif:<notification_id>'.
  event_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- Backoff schedule: 1, 5, 15, 60 minutes.
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  skipped_at TIMESTAMPTZ,
  skip_reason TEXT,
  last_error TEXT,
  CONSTRAINT push_outbox_dedupe_key_key UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_push_outbox_pending
  ON public.push_outbox(next_attempt_at)
  WHERE sent_at IS NULL AND skipped_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_push_outbox_conversation
  ON public.push_outbox(conversation_id)
  WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_push_outbox_event
  ON public.push_outbox(event_key);

ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;

-- No policies: only the service role reads/writes it. The settings panel shows
-- devices (push_subscriptions), never the queue.

-- ------------------------------------------------------------
-- Recipient configuration for UNASSIGNED threads.
--
-- An assigned thread alerts exactly one person (its assignee). An unassigned
-- thread used to alert "the whole team"; a tenant with 13 agents does not want
-- 13 phones ringing for the shared queue. Defaults keep the old behaviour
-- (owner/admin/agent), and `unassigned_alert_members` narrows it to a list.
-- ------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS unassigned_alert_roles TEXT[] NOT NULL
    DEFAULT ARRAY['owner', 'admin', 'agent']::TEXT[],
  ADD COLUMN IF NOT EXISTS unassigned_alert_members UUID[];

COMMENT ON COLUMN public.accounts.unassigned_alert_roles IS
  'Roles that receive a push for an unassigned conversation. Never viewers.';
COMMENT ON COLUMN public.accounts.unassigned_alert_members IS
  'Optional subset of the roles above. NULL = every member holding those roles.';

-- ------------------------------------------------------------
-- Would this user accept a push of this kind right now?
--
-- Missing row means "never opened the settings" → all defaults are on.
-- The notification RECORD is never gated by this; it is history.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_enabled_for(p_user UUID, p_kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN NOT np.push_enabled THEN FALSE
        WHEN p_kind = 'customer_message' THEN np.customer_message
        WHEN p_kind = 'conversation_assigned' THEN np.conversation_assigned
        WHEN p_kind = 'ai_handoff' THEN np.ai_handoff
        WHEN p_kind = 'report_alert' THEN np.report_alert
        ELSE TRUE
      END
      FROM public.notification_preferences np
      WHERE np.user_id = p_user
    ),
    TRUE
  );
$$;

COMMENT ON FUNCTION public.push_enabled_for(UUID, TEXT) IS
  'Channel + type switch for one user. Missing preferences row = defaults (on).';

-- ------------------------------------------------------------
-- Enqueue one customer message for every eligible recipient.
--
-- Returns TRUE when at least one outbox row was created or upgraded. Never
-- raises: the caller is a trigger on `messages`, and a push bug must not
-- reject a customer's WhatsApp message.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_push_for_message(p_message_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER := 0;
  v_bucket TEXT;
BEGIN
  BEGIN
    SELECT 'conv:' || m.conversation_id || ':' ||
           floor(extract(epoch FROM now()) / 60)::bigint
      INTO v_bucket
      FROM public.messages m
     WHERE m.id = p_message_id;

    IF v_bucket IS NULL THEN
      RETURN FALSE;
    END IF;

    WITH ins AS (
    INSERT INTO public.push_outbox (
      account_id, user_id, conversation_id, kind, severity,
      contact_name, preview, url, dedupe_key, event_key
    )
    SELECT
      c.account_id,
      r.user_id,
      c.id,
      'customer_message',
      1,
      ct.name,
      left(coalesce(m.content_text, ''), 240),
      '/inbox?c=' || c.id,
      'conv:' || c.id || ':' || r.user_id || ':' ||
        floor(extract(epoch FROM now()) / 60)::bigint,
      'msg:' || m.id || ':' || r.user_id
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    LEFT JOIN public.contacts ct ON ct.id = c.contact_id
    JOIN public.accounts a ON a.id = c.account_id
    CROSS JOIN LATERAL (
      -- Assigned thread → its assignee only.
      SELECT c.assigned_agent_id AS user_id
       WHERE c.assigned_agent_id IS NOT NULL
      UNION
      -- Unassigned thread → the configured triage set.
      SELECT p.user_id
        FROM public.profiles p
       WHERE c.assigned_agent_id IS NULL
         AND p.account_id = c.account_id
         AND p.account_role::text = ANY (a.unassigned_alert_roles)
         AND p.blocked_at IS NULL
         AND (a.unassigned_alert_members IS NULL
              OR p.user_id = ANY (a.unassigned_alert_members))
    ) r
    WHERE m.id = p_message_id
      AND m.sender_type = 'customer'
      AND r.user_id IS NOT NULL
      AND public.push_enabled_for(r.user_id, 'customer_message')
      -- No device, no row. A team that has not enabled notifications yet must
      -- not accumulate a queue that replays stale alerts the day a phone is
      -- registered (production: 13 members, zero devices, 130 rows/minute).
      AND EXISTS (
        SELECT 1 FROM public.push_subscriptions s
         WHERE s.user_id = r.user_id AND s.account_id = c.account_id
      )
    ON CONFLICT (dedupe_key) DO UPDATE
      SET severity = GREATEST(public.push_outbox.severity, EXCLUDED.severity),
          kind = CASE
            WHEN EXCLUDED.severity > public.push_outbox.severity THEN EXCLUDED.kind
            ELSE public.push_outbox.kind
          END,
          preview = CASE
            WHEN EXCLUDED.severity >= public.push_outbox.severity THEN EXCLUDED.preview
            ELSE public.push_outbox.preview
          END
      WHERE public.push_outbox.sent_at IS NULL
        AND public.push_outbox.skipped_at IS NULL
    RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*) FILTER (WHERE is_new) INTO v_rows FROM ins;

    RETURN v_rows > 0;
  EXCEPTION WHEN OTHERS THEN
    -- Swallowed on purpose: the message lands, `reconcile_push_outbox()` repairs
    -- the alert within a minute and the count surfaces the failure.
    RETURN FALSE;
  END;
END;
$$;

-- ------------------------------------------------------------
-- Enqueue one notification row for its own recipient.
--
-- `notifications` is already written per recipient (assignment, handoff and
-- report alerts all insert one row each), so this never fans out: it maps
-- 1 notification → 1 outbox row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_push_for_notification(p_notification_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER := 0;
BEGIN
  BEGIN
    WITH ins AS (
    INSERT INTO public.push_outbox (
      account_id, user_id, conversation_id, notification_id, kind, severity,
      contact_name, preview, url, dedupe_key, event_key
    )
    SELECT
      n.account_id,
      n.user_id,
      n.conversation_id,
      n.id,
      CASE n.type
        WHEN 'ai_handoff_unassigned' THEN 'ai_handoff'
        WHEN 'conversation_assigned' THEN 'conversation_assigned'
        ELSE 'report_alert'
      END,
      CASE n.type
        WHEN 'ai_handoff_unassigned' THEN 3
        WHEN 'conversation_assigned' THEN 2
        ELSE 4
      END,
      ct.name,
      n.body,
      CASE
        WHEN n.conversation_id IS NOT NULL THEN '/inbox?c=' || n.conversation_id
        ELSE '/notifications'
      END,
      CASE
        WHEN n.type = 'report_alert' OR n.conversation_id IS NULL
          THEN 'report:' || n.id
        ELSE 'conv:' || n.conversation_id || ':' || n.user_id || ':' ||
             floor(extract(epoch FROM now()) / 60)::bigint
      END,
      'notif:' || n.id
    FROM public.notifications n
    LEFT JOIN public.conversations c ON c.id = n.conversation_id
    LEFT JOIN public.contacts ct ON ct.id = COALESCE(n.contact_id, c.contact_id)
    WHERE n.id = p_notification_id
      AND n.user_id IS DISTINCT FROM n.actor_user_id
      AND public.push_enabled_for(
        n.user_id,
        CASE n.type
          WHEN 'ai_handoff_unassigned' THEN 'ai_handoff'
          WHEN 'conversation_assigned' THEN 'conversation_assigned'
          ELSE 'report_alert'
        END
      )
      AND EXISTS (
        SELECT 1 FROM public.push_subscriptions s
         WHERE s.user_id = n.user_id AND s.account_id = n.account_id
      )
    ON CONFLICT (dedupe_key) DO UPDATE
      SET severity = GREATEST(public.push_outbox.severity, EXCLUDED.severity),
          kind = CASE
            WHEN EXCLUDED.severity > public.push_outbox.severity THEN EXCLUDED.kind
            ELSE public.push_outbox.kind
          END,
          contact_name = CASE
            WHEN EXCLUDED.severity > public.push_outbox.severity THEN EXCLUDED.contact_name
            ELSE public.push_outbox.contact_name
          END,
          preview = CASE
            WHEN EXCLUDED.severity > public.push_outbox.severity THEN EXCLUDED.preview
            ELSE public.push_outbox.preview
          END,
          notification_id = CASE
            WHEN EXCLUDED.severity > public.push_outbox.severity THEN EXCLUDED.notification_id
            ELSE public.push_outbox.notification_id
          END
      WHERE public.push_outbox.sent_at IS NULL
        AND public.push_outbox.skipped_at IS NULL
    RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*) FILTER (WHERE is_new) INTO v_rows FROM ins;

    RETURN v_rows > 0;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;
END;
$$;

-- ------------------------------------------------------------
-- Triggers. Both are `AFTER INSERT … FOR EACH ROW` and do nothing but delegate,
-- so the trigger body cannot grow into something that fails on business data.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_enqueue_on_customer_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'customer' THEN
    PERFORM public.enqueue_push_for_message(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_enqueue_on_customer_message ON public.messages;
CREATE TRIGGER push_enqueue_on_customer_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.push_enqueue_on_customer_message();

CREATE OR REPLACE FUNCTION public.push_enqueue_on_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_push_for_notification(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_enqueue_on_notification ON public.notifications;
CREATE TRIGGER push_enqueue_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.push_enqueue_on_notification();

-- ------------------------------------------------------------
-- The reconciler: anti-join the last window against the outbox.
--
-- A trigger that swallows an exception (by design) can lose an event. This
-- function finds the events that have no outbox row and re-enqueues them, so
-- the failure costs at most one cron minute instead of the alert.
--
-- Returns the number of events it had to backfill. Non-zero = the trigger
-- failed for that event; the number is published in the cron response.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_push_outbox(
  p_window INTERVAL DEFAULT INTERVAL '15 minutes'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reconciled INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT m.id
      FROM public.messages m
     WHERE m.sender_type = 'customer'
       AND m.created_at > now() - p_window
       AND NOT EXISTS (
         SELECT 1 FROM public.push_outbox o
          WHERE o.event_key LIKE 'msg:' || m.id || ':%'
       )
  LOOP
    IF public.enqueue_push_for_message(r.id) THEN
      v_reconciled := v_reconciled + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT n.id
      FROM public.notifications n
     WHERE n.created_at > now() - p_window
       AND NOT EXISTS (
         SELECT 1 FROM public.push_outbox o
          WHERE o.event_key = 'notif:' || n.id
       )
  LOOP
    IF public.enqueue_push_for_notification(r.id) THEN
      v_reconciled := v_reconciled + 1;
    END IF;
  END LOOP;

  RETURN v_reconciled;
END;
$$;

COMMENT ON FUNCTION public.reconcile_push_outbox(INTERVAL) IS
  'Backfills push_outbox rows for events whose trigger failed. Non-zero return = a trigger bug.';

-- ------------------------------------------------------------
-- Retention: a 4-hour-old alert is noise, and an unread queue is a table.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_push_outbox(p_keep INTERVAL DEFAULT INTERVAL '30 days')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.push_outbox
   WHERE created_at < now() - p_keep
     AND (sent_at IS NOT NULL OR skipped_at IS NOT NULL);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON TABLE public.push_outbox IS
  'Durable per-recipient push queue: enqueued in the event transaction, claimed and sent by /api/push/sweep.';
