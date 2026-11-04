-- 091 — inbox counts follow the active filters, and a thread keeps a status history
--
-- Two changes that share one surface (the inbox list + the thread header):
--
-- 1. `inbox_page` returned chip counts computed over the WHOLE account, so
--    changing the filter left the channel/number numbers untouched — the
--    number next to a chip was not the number of results you'd get by
--    clicking it. Every count is now computed under the same predicates as
--    the list itself (search, filters, tags, company, assignee, participant),
--    excluding only the dimension the count belongs to.
--
-- 2. `conversations.status` is a workflow state that now moves on its own
--    (migration 090). A state without a history is not auditable and cannot
--    answer "who closed this, and why", so every transition is recorded in
--    `conversation_status_events` and mirrored into the tenant activity log.
--    `conversations.closed_by` carries the current answer for filtering and
--    reports (NULL + `status_auto` = the system did it).
--
-- The history table is deliberately separate from `account_activity_log`:
-- the activity log is purged after 180 days and is a paid feature gate,
-- while a thread's own lifecycle belongs to the inbox and must outlive both.

-- ============================================================
-- 1. Who closed it
-- ============================================================
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.conversations.closed_by IS
  'human who closed the thread; NULL means the system did it (see status_auto) or the thread is not closed';

-- ============================================================
-- 2. The history
-- ============================================================
CREATE TABLE IF NOT EXISTS public.conversation_status_events (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  -- Snapshot, like account_activity_log: the row still explains itself after
  -- the member renames or leaves.
  actor_user_id UUID,
  actor_name TEXT,
  actor_role account_role_enum,
  -- 'app' = a signed-in person; 'system' = cron / webhook / automation / API.
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'system')),
  reason TEXT NOT NULL DEFAULT 'manual' CHECK (reason IN (
    'manual',        -- a person picked the status in the inbox
    'auto_window',   -- 24h service window lapsed → pending
    'auto_idle',     -- idle past the account threshold → closed
    'inbound',       -- the customer wrote: reopen
    'outbound',      -- we wrote: reopen a closed thread
    'automation',    -- a rule's "close conversation" action
    'api',           -- public API / integration
    'sweep'          -- reserved
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_status_events_conversation
  ON public.conversation_status_events(conversation_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_conv_status_events_account
  ON public.conversation_status_events(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conv_status_events_account_closed
  ON public.conversation_status_events(account_id, to_status);

ALTER TABLE public.conversation_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read their account status events"
  ON public.conversation_status_events;
CREATE POLICY "Members read their account status events"
  ON public.conversation_status_events FOR SELECT
  USING (public.is_account_member(account_id));

-- Writes happen only through the trigger below (SECURITY DEFINER).
DROP POLICY IF EXISTS "No direct writes to status events"
  ON public.conversation_status_events;

-- ============================================================
-- 3. Attribution — who is acting, right now
-- ============================================================
CREATE OR REPLACE FUNCTION public.conversations_status_attribution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- `auth.uid()` is the caller's JWT: a person in the inbox, or NULL when
    -- the write comes from the service role (cron, webhook, automation).
    IF NEW.status = 'closed' THEN
      NEW.closed_by := auth.uid();
    ELSE
      NEW.closed_by := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.conversations_status_attribution() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.conversations_status_attribution() FROM PUBLIC;

DROP TRIGGER IF EXISTS conversations_status_attribution ON public.conversations;
CREATE TRIGGER conversations_status_attribution
  BEFORE UPDATE OF status ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.conversations_status_attribution();

-- ============================================================
-- 4. Recording — the event + the tenant activity log
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_conversation_status_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := auth.uid();
  v_source  TEXT := CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'app' END;
  v_reason  TEXT := NULLIF(btrim(COALESCE(current_setting('exbolt.status_reason', true), '')), '');
  v_name    TEXT;
  v_role    account_role_enum;
  v_label   TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  -- A cascade delete of the account reaches here after the parent row is
  -- gone; writing a row for a tenant that no longer exists would abort the
  -- delete (same trap as the 070 audit triggers).
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id) THEN
    RETURN NULL;
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT p.full_name, p.account_role INTO v_name, v_role
    FROM profiles p WHERE p.user_id = v_actor;
  END IF;

  SELECT ct.name INTO v_label
  FROM contacts ct WHERE ct.id = NEW.contact_id;

  INSERT INTO conversation_status_events (
    account_id, conversation_id, from_status, to_status,
    actor_user_id, actor_name, actor_role, source, reason
  ) VALUES (
    NEW.account_id, NEW.id, OLD.status, NEW.status,
    v_actor, v_name, v_role, v_source, COALESCE(v_reason, 'manual')
  );

  INSERT INTO account_activity_log (
    account_id, actor_user_id, actor_name, actor_role, source,
    action, category, target_type, target_id, target_label, changes, metadata
  ) VALUES (
    NEW.account_id, v_actor, v_name, v_role, v_source,
    'conversation.status_changed', 'inbox', 'conversation', NEW.id::TEXT, v_label,
    jsonb_build_object('status', jsonb_build_object('from', OLD.status, 'to', NEW.status)),
    jsonb_build_object('reason', COALESCE(v_reason, 'manual'))
  );

  RETURN NULL;
EXCEPTION
  WHEN foreign_key_violation THEN
    RETURN NULL;
END;
$$;

ALTER FUNCTION public.record_conversation_status_event() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_conversation_status_event() FROM PUBLIC;

DROP TRIGGER IF EXISTS record_conversation_status_event ON public.conversations;
CREATE TRIGGER record_conversation_status_event
  AFTER UPDATE OF status ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.record_conversation_status_event();

-- ============================================================
-- 5. Reason plumbing on the message stream
-- ============================================================
-- Re-emits migration 090's trigger with the reason set before each reopen, so
-- a history row says "the customer wrote" rather than a bare "manual".
CREATE OR REPLACE FUNCTION public.reopen_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'customer' THEN
    PERFORM set_config('exbolt.status_reason', 'inbound', true);
    UPDATE conversations
    SET status = 'open',
        status_auto = false,
        last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at)
    WHERE id = NEW.conversation_id
      AND status <> 'open';
  ELSIF (NEW.sender_type IN ('agent', 'bot') OR NEW.ai_generated)
        AND NEW.status IS DISTINCT FROM 'failed' THEN
    PERFORM set_config('exbolt.status_reason', 'outbound', true);
    UPDATE conversations
    SET status = 'open',
        status_auto = false,
        last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at)
    WHERE id = NEW.conversation_id
      AND status = 'closed';
  END IF;

  -- Transaction-local: leave nothing behind for the next write in this tx.
  PERFORM set_config('exbolt.status_reason', '', true);
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.reopen_conversation_on_message() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reopen_conversation_on_message() FROM PUBLIC;

-- ============================================================
-- 6. The sweep writes through one function, so the reason is always set
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_conversation_status(
  p_ids UUID[],
  p_status TEXT,
  p_reason TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed INTEGER := 0;
BEGIN
  IF p_status NOT IN ('open', 'pending', 'closed') THEN
    RAISE EXCEPTION 'unknown status: %', p_status USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('exbolt.status_reason', COALESCE(p_reason, ''), true);

  UPDATE conversations
  SET status = p_status,
      status_auto = true
  WHERE id = ANY(p_ids)
    AND status <> p_status;

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  PERFORM set_config('exbolt.status_reason', '', true);
  RETURN v_changed;
END;
$$;

ALTER FUNCTION public.apply_conversation_status(UUID[], TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_conversation_status(UUID[], TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_conversation_status(UUID[], TEXT, TEXT) TO service_role;

-- ============================================================
-- 7. inbox_page — counts that follow the list
-- ============================================================
CREATE OR REPLACE FUNCTION public.inbox_page(
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0,
  p_search TEXT DEFAULT NULL,
  p_filter TEXT DEFAULT 'all',
  p_channel TEXT DEFAULT NULL,
  p_number UUID DEFAULT NULL,
  p_assignee UUID DEFAULT NULL,
  p_participant UUID DEFAULT NULL,
  p_participant_days INTEGER DEFAULT 30,
  p_tag_ids UUID[] DEFAULT NULL,
  p_company TEXT DEFAULT NULL,
  p_tz TEXT DEFAULT 'Africa/Cairo'
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_role account_role_enum;
  v_like TEXT;
  v_part UUID[];
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  SELECT p.account_id, p.account_role INTO v_account, v_role
  FROM profiles p WHERE p.user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'caller is not a member of an account' USING ERRCODE = '42501';
  END IF;

  IF p_filter IS NOT NULL AND p_filter NOT IN
     ('all', 'unread', 'waiting', 'unassigned', 'expiring', 'open', 'pending', 'closed') THEN
    RAISE EXCEPTION 'unknown inbox filter: %', p_filter USING ERRCODE = '22023';
  END IF;

  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    v_like := '%' || btrim(p_search) || '%';
  END IF;

  IF p_participant IS NOT NULL THEN
    v_part := public.member_conversation_ids(p_participant, COALESCE(p_participant_days, 30), p_tz);
  END IF;

  RETURN (
    -- Everything the caller narrowed by EXCEPT the three dimensions that own
    -- their own chips (filter / channel / number). Their counts are applied
    -- per chip below, which is what makes "the number is the result count"
    -- true for all three rows of chips at once.
    WITH scoped AS (
      SELECT c.id,
             c.status,
             c.unread_count,
             c.last_inbound_at,
             c.last_reply_at,
             c.assigned_agent_id,
             c.channel,
             COALESCE(c.whatsapp_config_id::TEXT, 'none') AS number_key,
             (
               p_filter IS NULL
               OR p_filter = 'all'
               OR (p_filter = 'unread' AND c.unread_count > 0)
               OR (
                 p_filter = 'waiting'
                 AND c.status <> 'closed'
                 AND c.last_inbound_at IS NOT NULL
                 AND (c.last_reply_at IS NULL OR c.last_reply_at < c.last_inbound_at)
               )
               OR (
                 p_filter = 'expiring'
                 AND c.status <> 'closed'
                 AND c.last_inbound_at IS NOT NULL
                 AND (c.last_reply_at IS NULL OR c.last_reply_at < c.last_inbound_at)
                 AND c.last_inbound_at + interval '24 hours' > now()
                 AND c.last_inbound_at + interval '24 hours' <= now() + interval '2 hours'
               )
               OR (
                 p_filter = 'unassigned'
                 AND c.status = 'open'
                 AND c.assigned_agent_id IS NULL
               )
               OR (p_filter IN ('open', 'pending', 'closed') AND c.status = p_filter)
             ) AS matches_filter
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.account_id = v_account
        AND (
          v_like IS NULL
          OR ct.name ILIKE v_like
          OR ct.phone ILIKE v_like
          OR c.last_message_text ILIKE v_like
        )
        AND (p_assignee IS NULL OR c.assigned_agent_id = p_assignee)
        AND (v_part IS NULL OR c.id = ANY(v_part))
        AND (
          p_tag_ids IS NULL
          OR cardinality(p_tag_ids) = 0
          OR EXISTS (
            SELECT 1 FROM contact_tags x
            WHERE x.contact_id = c.contact_id AND x.tag_id = ANY(p_tag_ids)
          )
        )
        AND (p_company IS NULL OR btrim(ct.company) = btrim(p_company))
    ),
    base AS (
      SELECT c.*
      FROM conversations c
      JOIN scoped s ON s.id = c.id
      WHERE s.matches_filter
        AND (p_channel IS NULL OR s.channel = p_channel)
        AND (p_number IS NULL OR s.number_key = p_number::TEXT)
    ),
    page AS (
      SELECT * FROM base
      ORDER BY
        (CASE WHEN p_filter IN ('waiting', 'expiring') THEN last_inbound_at END) ASC NULLS LAST,
        last_message_at DESC NULLS LAST,
        id DESC
      LIMIT v_limit OFFSET v_offset
    ),
    chip_filters AS (
      -- Same dimension the list itself filters on: channel + number stay applied.
      SELECT
        count(*)                                                                   AS all_n,
        count(*) FILTER (WHERE unread_count > 0)                                   AS unread_n,
        count(*) FILTER (
          WHERE status <> 'closed'
            AND last_inbound_at IS NOT NULL
            AND (last_reply_at IS NULL OR last_reply_at < last_inbound_at)
        )                                                                          AS waiting_n,
        count(*) FILTER (
          WHERE status <> 'closed'
            AND last_inbound_at IS NOT NULL
            AND (last_reply_at IS NULL OR last_reply_at < last_inbound_at)
            AND last_inbound_at + interval '24 hours' > now()
            AND last_inbound_at + interval '24 hours' <= now() + interval '2 hours'
        )                                                                          AS expiring_n,
        count(*) FILTER (WHERE status = 'open' AND assigned_agent_id IS NULL)      AS unassigned_n,
        count(*) FILTER (WHERE status = 'open')                                    AS open_n,
        count(*) FILTER (WHERE status = 'pending')                                 AS pending_n,
        count(*) FILTER (WHERE status = 'closed')                                  AS closed_n
      FROM scoped
      WHERE (p_channel IS NULL OR channel = p_channel)
        AND (p_number IS NULL OR number_key = p_number::TEXT)
    ),
    chip_channels AS (
      SELECT channel, count(*) AS n
      FROM scoped
      WHERE matches_filter
        AND (p_number IS NULL OR number_key = p_number::TEXT)
      GROUP BY 1
    ),
    chip_numbers AS (
      SELECT number_key, count(*) AS n
      FROM scoped
      WHERE matches_filter
        AND (p_channel IS NULL OR channel = p_channel)
      GROUP BY 1
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM base),
      'rows', COALESCE(
        (
          SELECT jsonb_agg(
            to_jsonb(p) || jsonb_build_object(
              'contact', to_jsonb(ct) || jsonb_build_object(
                'contact_tags', COALESCE(
                  (
                    SELECT jsonb_agg(jsonb_build_object(
                             'tags', jsonb_build_object(
                               'id', tg.id, 'name', tg.name, 'color', tg.color
                             )
                           ))
                    FROM contact_tags x
                    JOIN tags tg ON tg.id = x.tag_id
                    WHERE x.contact_id = ct.id
                  ),
                  '[]'::jsonb
                )
              )
            )
            ORDER BY
              (CASE WHEN p_filter IN ('waiting', 'expiring') THEN p.last_inbound_at END) ASC NULLS LAST,
              p.last_message_at DESC NULLS LAST,
              p.id DESC
          )
          FROM page p
          JOIN contacts ct ON ct.id = p.contact_id
        ),
        '[]'::jsonb
      ),
      'counts', jsonb_build_object(
        -- Same number as the "all" chip: what the current narrow set holds.
        'total', (SELECT all_n FROM chip_filters),
        'filters', (
          SELECT jsonb_build_object(
            'all', all_n,
            'unread', unread_n,
            'waiting', waiting_n,
            'expiring', expiring_n,
            'unassigned', unassigned_n,
            'open', open_n,
            'pending', pending_n,
            'closed', closed_n
          )
          FROM chip_filters
        ),
        'channels', COALESCE(
          (SELECT jsonb_object_agg(s.channel, s.n) FROM chip_channels s),
          '{}'::jsonb
        ),
        'numbers', COALESCE(
          (SELECT jsonb_object_agg(s.number_key, s.n) FROM chip_numbers s),
          '{}'::jsonb
        ),
        -- Company options come from the account, not from the loaded page:
        -- the filter picker used to offer only companies visible in memory.
        'companies', COALESCE((
          SELECT jsonb_agg(s.name)
          FROM (
            SELECT DISTINCT btrim(company) AS name
            FROM contacts
            WHERE account_id = v_account AND company IS NOT NULL AND btrim(company) <> ''
            ORDER BY 1 LIMIT 200
          ) s
        ), '[]'::jsonb)
      )
    )
  );
END;
$$;

ALTER FUNCTION public.inbox_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID, UUID, UUID, INTEGER, UUID[], TEXT, TEXT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.inbox_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID, UUID, UUID, INTEGER, UUID[], TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID, UUID, UUID, INTEGER, UUID[], TEXT, TEXT)
  TO authenticated;
