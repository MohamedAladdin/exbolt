-- ============================================================
-- 089 — inbox_page: one server-side query for the Inbox list
--
-- Why: the list was paged 25-at-a-time in the browser and every filter,
-- search box and chip count ran over the rows that had loaded so far. That
-- made search answer "no results" for a customer sitting on page 30 and made
-- the number/channel chips undercount (8 and 17 instead of 965 and 383).
-- Filtering and counting belong in the database: `inbox_page` applies the
-- same predicates the client used to apply in memory, returns only the page
-- asked for, and returns the exact total plus the account-level counts.
--
-- Semantics are kept 1:1 with src/lib/inbox/inbox-filters.ts:
--   unread    → unread_count > 0
--   waiting   → not closed, inbound after (or without) our last reply
--   expiring  → waiting and the 24h window closes within 2h
--   unassigned→ open with no assignee
--   open/pending/closed → status
-- "waiting"/"expiring" keep their oldest-inbound-first order.
-- Search covers contact name, phone and last message text (what the client
-- searched), across the WHOLE table, not the loaded page.
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

  -- A member deep link filters by the conversations they replied in; the ids
  -- come from the same `turns` definition the profile card counted.
  IF p_participant IS NOT NULL THEN
    v_part := public.member_conversation_ids(p_participant, COALESCE(p_participant_days, 30), p_tz);
  END IF;

  RETURN (
    WITH base AS (
      SELECT c.*
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.account_id = v_account
        AND (
          v_like IS NULL
          OR ct.name ILIKE v_like
          OR ct.phone ILIKE v_like
          OR c.last_message_text ILIKE v_like
        )
        AND (p_channel IS NULL OR c.channel = p_channel)
        AND (p_number IS NULL OR c.whatsapp_config_id = p_number)
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
        AND (
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
        )
    ),
    page AS (
      SELECT * FROM base
      ORDER BY
        (CASE WHEN p_filter IN ('waiting', 'expiring') THEN last_inbound_at END) ASC NULLS LAST,
        last_message_at DESC NULLS LAST,
        id DESC
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      -- Exact size of the filtered set: drives has-more and the result count.
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
      -- Account-level chips (channels + numbers). Deliberately NOT filtered:
      -- they answer "how much is in this account", which is what the chips
      -- showed before the list was paged.
      'counts', jsonb_build_object(
        'total', (SELECT count(*) FROM conversations WHERE account_id = v_account),
        'channels', COALESCE((
          SELECT jsonb_object_agg(s.channel, s.n)
          FROM (
            SELECT channel, count(*) AS n
            FROM conversations WHERE account_id = v_account GROUP BY 1
          ) s
        ), '{}'::jsonb),
        'numbers', COALESCE((
          SELECT jsonb_object_agg(s.k, s.n)
          FROM (
            SELECT COALESCE(whatsapp_config_id::text, 'none') AS k, count(*) AS n
            FROM conversations WHERE account_id = v_account GROUP BY 1
          ) s
        ), '{}'::jsonb),
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
