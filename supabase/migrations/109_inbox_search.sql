-- ============================================================
-- 109 — SEARCH INSIDE CONVERSATIONS · adjustable window
--
-- `inbox_page()` searched the contact's name, phone and the last message line.
-- A customer who was never saved as a contact was therefore unfindable by
-- anything they actually wrote (reported 2026-11-05: the team could not find
-- "Yasmine Osama" by her name because no contact row carried it, and a customer
-- asked for a number the desk did not have).
--
-- Two new parameters, both with product defaults:
--   p_search_days  INTEGER DEFAULT 30   — how far back the message scan looks
--   p_search_scope TEXT    DEFAULT 'all' — 'all' = messages too, 'name' = the
--                                          old behaviour (contact only)
--
-- The message scan is an EXISTS on the conversation, so it never multiplies
-- rows and cannot change the counts or the ordering. It is bounded by a date
-- window on purpose: an unbounded ILIKE over the whole message history is the
-- classic way a busy inbox becomes slow.
--
-- Idempotent: CREATE OR REPLACE only.
-- ============================================================

-- CREATE OR REPLACE only replaces an IDENTICAL signature; adding parameters
-- creates a second overload, and every defaulted call then fails with
-- «function inbox_page(...) is not unique». Drop the older overloads first.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'inbox_page'
       AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%p_search_scope%'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.inbox_page(
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0,
  p_search TEXT DEFAULT NULL,
  -- Search tuning (migration 109): how far back to look, and whether to look
  -- inside the messages or only at the contact's name/number.
  p_search_days INTEGER DEFAULT 30,
  p_search_scope TEXT DEFAULT 'all',
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
  v_search_days INTEGER := 30;
  v_search_scope TEXT := 'all';
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
     ('all', 'unread', 'waiting', 'unassigned', 'expiring', 'open', 'pending', 'closed', 'followup') THEN
    RAISE EXCEPTION 'unknown inbox filter: %', p_filter USING ERRCODE = '22023';
  END IF;

  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    v_like := '%' || btrim(p_search) || '%';
  END IF;

  -- A negative or absurd window would scan the whole history; 30 days is the
  -- product default, 10 years is the ceiling a human could reasonably mean.
  v_search_days := LEAST(GREATEST(COALESCE(p_search_days, 30), 1), 3650);
  v_search_scope := CASE WHEN p_search_scope = 'name' THEN 'name' ELSE 'all' END;

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
               -- «محتاجة متابعة»: the customer went quiet and the ball is in
               -- their court — pending, WE wrote last, nothing unread. It is a
               -- view over the pending queue, not a fourth status.
               OR (
                 p_filter = 'followup'
                 AND c.status = 'pending'
                 AND c.last_inbound_at IS NOT NULL
                 AND (c.last_reply_at IS NULL OR c.last_reply_at >= c.last_inbound_at)
                 AND COALESCE(c.unread_count, 0) = 0
                 -- Cooldown: without it the queue is just «معلّقة» again
                 -- (on live it was 583 = 583). A thread we nagged yesterday is
                 -- not due today.
                 AND COALESCE(c.last_reply_at, c.last_inbound_at) < now() - interval '3 days'
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
          -- Inside the conversation, bounded by the chosen window: a customer
          -- who was never saved as a contact is found by what they said, not by
          -- a number the team does not have (reported 2026-11-05).
          OR (
            v_search_scope = 'all'
            AND EXISTS (
              SELECT 1 FROM messages m
               WHERE m.conversation_id = c.id
                 AND m.created_at >= now() - make_interval(days => v_search_days)
                 AND m.content_text ILIKE v_like
            )
          )
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
        (CASE WHEN p_filter IN ('waiting', 'expiring', 'followup') THEN last_inbound_at END) ASC NULLS LAST,
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
        count(*) FILTER (WHERE status = 'closed')                                  AS closed_n,
        count(*) FILTER (
          WHERE status = 'pending'
            AND last_inbound_at IS NOT NULL
            AND (last_reply_at IS NULL OR last_reply_at >= last_inbound_at)
            AND COALESCE(unread_count, 0) = 0
            AND COALESCE(last_reply_at, last_inbound_at) < now() - interval '3 days'
        )                                                                          AS followup_n
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
              (CASE WHEN p_filter IN ('waiting', 'expiring', 'followup') THEN p.last_inbound_at END) ASC NULLS LAST,
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
            'closed', closed_n,
            'followup', followup_n
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
