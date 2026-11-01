-- ============================================================
-- 082 — Reports module: saved report definitions + one generic runner
--
-- Why: the dashboard answers "how is it going right now" for four fixed
-- windows. A clinic manager also needs "who answered what, how fast, which
-- templates earned replies, what the pipeline closed" for an arbitrary
-- period, and needs to keep that question for next month. Nothing in the
-- product could do that: `dashboard_overview` / `member_profile` are both
-- fixed-shape RPCs, and every export in the repo is a client-side CSV of
-- the page you are already looking at.
--
-- This migration adds:
--
--   1. `saved_reports` — a named, account-scoped report definition (the
--      config is JSONB, written and validated by
--      `src/lib/reports/catalog.ts`). Saved so a manager does not rebuild
--      the same question every Monday.
--
--   2. `run_report(config)` — ONE read-only runner for six datasets
--      (messages, conversations, contacts, deals, broadcasts, team). It
--      takes a whitelisted config and returns `{rows, totals, columns}`.
--
-- Why the runner lives in Postgres and not in the route handler: a
-- 90-day message report is thousands of rows, and pulling them into Node
-- to sum them would move the whole account's traffic over the wire to
-- answer a question Postgres can answer with an index. Equally, the
-- config arrives from the browser, so NOTHING from it may reach the SQL
-- as an identifier: every dimension and metric is mapped through a CASE
-- here, and an unknown key raises (22023) instead of being ignored —
-- a silently dropped metric would ship a report that quietly says
-- something the user did not ask.
--
-- Semantics worth knowing when reading the output:
--   * `period` buckets are computed in the caller's timezone, so a
--     "day" is the clinic's day, not UTC's.
--   * `tag` dimension multiplies rows on purpose: a contact with two tags
--     counts once per tag, because the tag is the unit of the breakdown.
--   * response times use the same turn definition as `member_profile`
--     (customer message → first non-failed agent reply), so a number in
--     this module and the same number on a member profile agree.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.saved_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  -- Denormalised out of `config` so the list can group by it without
  -- parsing every JSONB row, and so a dataset we retire is still visible.
  dataset     TEXT NOT NULL,
  config      JSONB NOT NULL,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- A report is shared with the account by default: a manager builds the
  -- Monday view so the team can run it, which is the whole point of
  -- saving it. Private stays available for drafts.
  is_shared   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT saved_reports_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_saved_reports_account
  ON public.saved_reports (account_id, created_at DESC);

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saved_reports_select ON public.saved_reports;
CREATE POLICY saved_reports_select ON public.saved_reports
  FOR SELECT USING (is_account_member(account_id));

-- Writes go through /api/reports (which resolves the account from the
-- session), but RLS still has to carry the rule: any member may save their
-- own definition, admin+ may touch anyone's, and nobody may write into an
-- account they do not belong to.
DROP POLICY IF EXISTS saved_reports_insert ON public.saved_reports;
CREATE POLICY saved_reports_insert ON public.saved_reports
  FOR INSERT WITH CHECK (
    is_account_member(account_id, 'agent') AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS saved_reports_update ON public.saved_reports;
CREATE POLICY saved_reports_update ON public.saved_reports
  FOR UPDATE USING (
    is_account_member(account_id, 'agent')
    AND (created_by = auth.uid() OR is_account_member(account_id, 'admin'))
  );

DROP POLICY IF EXISTS saved_reports_delete ON public.saved_reports;
CREATE POLICY saved_reports_delete ON public.saved_reports
  FOR DELETE USING (
    is_account_member(account_id, 'agent')
    AND (created_by = auth.uid() OR is_account_member(account_id, 'admin'))
  );

-- ------------------------------------------------------------
-- _run_report(account, config) — the implementation; `run_report(config)`
-- below is the session-scoped wrapper that every API route calls.
--
--   {
--     "dataset":    "messages" | "conversations" | "contacts"
--                 | "deals" | "broadcasts" | "team",
--     "metrics":    ["..."],          -- empty/missing → dataset default
--     "dimensions": ["period", ...],  -- 0 dims → a single totals row
--     "grain":      "day" | "week" | "month",
--     "from":       "YYYY-MM-DD",     -- inclusive, caller's timezone
--     "to":         "YYYY-MM-DD",     -- inclusive, caller's timezone
--     "tz":         "Africa/Cairo",
--     "filters":    { "channel": ["whatsapp"], "agent": [uuid], ... },
--     "limit":      1000              -- capped at 5000
--   }
--
--   → { columns: [{key, kind}], rows: [...], totals: {...},
--       rowCount, truncated, dataset, from, to, timeZone, grain }
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._run_report(p_account UUID, p_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account  UUID := p_account;
  v_tz       TEXT := 'UTC';
  v_dataset  TEXT;
  v_grain    TEXT;
  v_from     DATE;
  v_to       DATE;
  v_start    TIMESTAMPTZ;
  v_end      TIMESTAMPTZ;
  v_limit    INTEGER;
  v_target   INTEGER;

  v_metrics  TEXT[];
  v_dims     TEXT[];
  v_filters  JSONB;

  v_key      TEXT;
  v_expr     TEXT;
  v_metric   TEXT;
  v_dim      TEXT;
  v_select   TEXT[] := '{}';
  v_metric_select TEXT[] := '{}';
  v_columns  JSONB  := '[]'::jsonb;
  v_group    TEXT;
  v_order    TEXT;
  v_joins    TEXT   := '';
  v_where    TEXT   := '';
  v_base     TEXT;
  v_sql      TEXT;
  v_rows     JSONB;
  v_base_tpl TEXT;
  v_base_prev TEXT;
  v_compare  BOOLEAN := FALSE;
  v_prev_start TIMESTAMPTZ;
  v_prev_end   TIMESTAMPTZ;
  v_prev_totals JSONB;
  v_count    INTEGER;
  v_truncated BOOLEAN := FALSE;
  v_totals   JSONB;
  v_dim_allow TEXT[];

  v_need_tag BOOLEAN;
  v_need_num BOOLEAN;
  v_need_pip BOOLEAN;
  v_need_stg BOOLEAN;
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'caller is not a member of an account' USING ERRCODE = '42501';
  END IF;

  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'report config must be a JSON object' USING ERRCODE = '22023';
  END IF;

  v_dataset := p_config->>'dataset';
  IF v_dataset IS NULL OR v_dataset NOT IN
     ('messages', 'conversations', 'contacts', 'deals', 'broadcasts', 'team') THEN
    RAISE EXCEPTION 'unknown report dataset: %', coalesce(v_dataset, 'null')
      USING ERRCODE = '22023';
  END IF;

  -- ---- timezone (an invalid one is a client bug, not a reason to 500) --
  IF NULLIF(p_config->>'tz', '') IS NOT NULL THEN
    BEGIN
      PERFORM now() AT TIME ZONE (p_config->>'tz');
      v_tz := p_config->>'tz';
    EXCEPTION WHEN invalid_parameter_value THEN
      v_tz := 'UTC';
    END;
  END IF;

  -- ---- period ----------------------------------------------------------
  v_from := COALESCE(NULLIF(p_config->>'from', '')::DATE, (now() AT TIME ZONE v_tz)::DATE - 29);
  v_to   := COALESCE(NULLIF(p_config->>'to', '')::DATE, (now() AT TIME ZONE v_tz)::DATE);

  IF v_to < v_from THEN
    RAISE EXCEPTION 'report period ends before it starts' USING ERRCODE = '22023';
  END IF;
  IF v_to - v_from > 366 THEN
    RAISE EXCEPTION 'report period is longer than a year' USING ERRCODE = '22023';
  END IF;

  v_start := (v_from::TIMESTAMP) AT TIME ZONE v_tz;
  v_end   := ((v_to + 1)::TIMESTAMP) AT TIME ZONE v_tz;

  v_grain := COALESCE(NULLIF(p_config->>'grain', ''), 'day');
  IF v_grain NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'unknown grain: %', v_grain USING ERRCODE = '22023';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE((p_config->>'limit')::INTEGER, 1000), 1), 5000);
  v_compare := COALESCE((p_config->>'compare')::BOOLEAN, FALSE);

  SELECT COALESCE(a.reply_target_minutes, 5) INTO v_target
  FROM accounts a WHERE a.id = v_account;
  v_target := COALESCE(v_target, 5);

  v_filters := COALESCE(p_config->'filters', '{}'::jsonb);
  IF jsonb_typeof(v_filters) <> 'object' THEN
    RAISE EXCEPTION 'report filters must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- ---- dimensions / metrics (missing → dataset default) ----------------
  SELECT COALESCE(array_agg(value), '{}')
    INTO v_dims
  FROM jsonb_array_elements_text(COALESCE(p_config->'dimensions', '[]'::jsonb)) AS t(value);

  SELECT COALESCE(array_agg(value), '{}')
    INTO v_metrics
  FROM jsonb_array_elements_text(COALESCE(p_config->'metrics', '[]'::jsonb)) AS t(value);

  IF array_length(v_metrics, 1) IS NULL THEN
    v_metrics := CASE v_dataset
      WHEN 'messages'      THEN ARRAY['messages', 'inbound', 'outbound', 'failed']
      WHEN 'conversations' THEN ARRAY['conversations', 'closed', 'first_response_avg']
      WHEN 'contacts'      THEN ARRAY['contacts']
      WHEN 'deals'         THEN ARRAY['deals', 'won', 'won_value']
      WHEN 'broadcasts'    THEN ARRAY['broadcasts', 'delivered', 'read', 'replied']
      ELSE                      ARRAY['replies', 'median_response_minutes']
    END;
  END IF;

  v_need_tag := ('tag' = ANY(v_dims)) OR (v_filters ? 'tag');
  v_need_num := ('number' = ANY(v_dims)) OR (v_filters ? 'number');
  v_need_pip := ('pipeline' = ANY(v_dims)) OR (v_filters ? 'pipeline');
  v_need_stg := ('stage' = ANY(v_dims)) OR (v_filters ? 'stage');

  -- ---- base: one normalised row per domain event -----------------------
  -- Every dataset fills the same column list so the aggregation below is
  -- written once. A column a dataset cannot produce stays NULL rather than
  -- being faked, so `sum(value)` over messages is NULL, not 0.
  v_base_tpl := CASE v_dataset
    WHEN 'messages' THEN $q$
      SELECT m.created_at               AS occurred_at,
             m.sender_id                AS agent_id,
             c.channel                  AS channel,
             m.status                   AS status,
             NULL::UUID                 AS pipeline_id,
             NULL::UUID                 AS stage_id,
             NULL::UUID                 AS broadcast_id,
             NULL::TEXT                 AS broadcast_name,
             NULL::NUMERIC              AS value,
             (m.sender_type = 'customer')            AS is_inbound,
             (m.sender_type <> 'customer')           AS is_outbound,
             m.ai_generated                          AS is_ai,
             -- Delivery/read are properties of what WE sent: an inbound
             -- message inherits status 'read' and would otherwise inflate
             -- the delivery rate past 100%.
             (m.sender_type <> 'customer'
              AND m.status IN ('delivered', 'read'))  AS is_delivered,
             (m.sender_type <> 'customer'
              AND m.status = 'read')                  AS is_read,
             (m.status = 'failed')                    AS is_failed,
             NULL::NUMERIC              AS resp_minutes,
             NULL::NUMERIC              AS days_to_close,
             NULL::INTEGER              AS recipients,
             NULL::INTEGER              AS sent_n,
             NULL::INTEGER              AS delivered_n,
             NULL::INTEGER              AS read_n,
             NULL::INTEGER              AS replied_n,
             NULL::INTEGER              AS failed_n,
             c.contact_id               AS contact_id,
             c.id                       AS conversation_id,
             c.whatsapp_config_id       AS number_id
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = :account
        AND m.created_at >= :start
        AND m.created_at <  :end
    $q$
    WHEN 'conversations' THEN $q$
      SELECT c.created_at                AS occurred_at,
             c.assigned_agent_id         AS agent_id,
             c.channel                   AS channel,
             c.status                    AS status,
             NULL::UUID                  AS pipeline_id,
             NULL::UUID                  AS stage_id,
             NULL::UUID                  AS broadcast_id,
             NULL::TEXT                  AS broadcast_name,
             NULL::NUMERIC               AS value,
             FALSE                       AS is_inbound,
             TRUE                        AS is_outbound,
             FALSE                       AS is_ai,
             FALSE                       AS is_delivered,
             FALSE                       AS is_read,
             FALSE                       AS is_failed,
             (SELECT extract(EPOCH FROM (min(m2.created_at) - c.first_inbound_at)) / 60.0
                FROM messages m2
               WHERE m2.conversation_id = c.id
                 AND m2.sender_type = 'agent'
                 AND m2.status <> 'failed'
                 AND m2.created_at >= COALESCE(c.first_inbound_at, c.created_at)
             )                           AS resp_minutes,
             CASE WHEN c.closed_at IS NOT NULL
                  THEN extract(EPOCH FROM (c.closed_at - c.created_at)) / 86400.0
             END                         AS days_to_close,
             NULL::INTEGER               AS recipients,
             NULL::INTEGER               AS sent_n,
             NULL::INTEGER               AS delivered_n,
             NULL::INTEGER               AS read_n,
             NULL::INTEGER               AS replied_n,
             NULL::INTEGER               AS failed_n,
             c.contact_id                AS contact_id,
             c.id                        AS conversation_id,
             c.whatsapp_config_id        AS number_id
      FROM conversations c
      WHERE c.account_id = :account
        AND c.created_at >= :start
        AND c.created_at <  :end
    $q$
    WHEN 'contacts' THEN $q$
      SELECT ct.created_at               AS occurred_at,
             NULL::UUID                  AS agent_id,
             ct.channel                  AS channel,
             NULL::TEXT                  AS status,
             NULL::UUID                  AS pipeline_id,
             NULL::UUID                  AS stage_id,
             NULL::UUID                  AS broadcast_id,
             NULL::TEXT                  AS broadcast_name,
             NULL::NUMERIC               AS value,
             TRUE                        AS is_inbound,
             FALSE                       AS is_outbound,
             FALSE                       AS is_ai,
             FALSE                       AS is_delivered,
             FALSE                       AS is_read,
             FALSE                       AS is_failed,
             NULL::NUMERIC               AS resp_minutes,
             NULL::NUMERIC               AS days_to_close,
             NULL::INTEGER               AS recipients,
             NULL::INTEGER               AS sent_n,
             NULL::INTEGER               AS delivered_n,
             NULL::INTEGER               AS read_n,
             NULL::INTEGER               AS replied_n,
             NULL::INTEGER               AS failed_n,
             ct.id                       AS contact_id,
             NULL::UUID                  AS conversation_id,
             NULL::UUID                  AS number_id
      FROM contacts ct
      WHERE ct.account_id = :account
        AND ct.created_at >= :start
        AND ct.created_at <  :end
    $q$
    WHEN 'deals' THEN $q$
      SELECT d.created_at                AS occurred_at,
             d.assigned_to               AS agent_id,
             NULL::TEXT                  AS channel,
             d.status                    AS status,
             d.pipeline_id               AS pipeline_id,
             d.stage_id                  AS stage_id,
             NULL::UUID                  AS broadcast_id,
             NULL::TEXT                  AS broadcast_name,
             d.value                     AS value,
             FALSE                       AS is_inbound,
             FALSE                       AS is_outbound,
             FALSE                       AS is_ai,
             FALSE                       AS is_delivered,
             FALSE                       AS is_read,
             FALSE                       AS is_failed,
             NULL::NUMERIC               AS resp_minutes,
             CASE WHEN d.closed_at IS NOT NULL
                  THEN extract(EPOCH FROM (d.closed_at - d.created_at)) / 86400.0
             END                         AS days_to_close,
             NULL::INTEGER               AS recipients,
             NULL::INTEGER               AS sent_n,
             NULL::INTEGER               AS delivered_n,
             NULL::INTEGER               AS read_n,
             NULL::INTEGER               AS replied_n,
             NULL::INTEGER               AS failed_n,
             d.contact_id                AS contact_id,
             d.conversation_id           AS conversation_id,
             NULL::UUID                  AS number_id
      FROM deals d
      WHERE d.account_id = :account
        AND d.created_at >= :start
        AND d.created_at <  :end
    $q$
    WHEN 'broadcasts' THEN $q$
      SELECT b.created_at                AS occurred_at,
             NULL::UUID                  AS agent_id,
             NULL::TEXT                  AS channel,
             b.status                    AS status,
             NULL::UUID                  AS pipeline_id,
             NULL::UUID                  AS stage_id,
             b.id                        AS broadcast_id,
             b.name                      AS broadcast_name,
             NULL::NUMERIC               AS value,
             FALSE                       AS is_inbound,
             TRUE                        AS is_outbound,
             FALSE                       AS is_ai,
             FALSE                       AS is_delivered,
             FALSE                       AS is_read,
             FALSE                       AS is_failed,
             NULL::NUMERIC               AS resp_minutes,
             NULL::NUMERIC               AS days_to_close,
             b.total_recipients          AS recipients,
             b.sent_count                AS sent_n,
             b.delivered_count           AS delivered_n,
             b.read_count                AS read_n,
             b.replied_count             AS replied_n,
             b.failed_count              AS failed_n,
             NULL::UUID                  AS contact_id,
             NULL::UUID                  AS conversation_id,
             NULL::UUID                  AS number_id
      FROM broadcasts b
      WHERE b.account_id = :account
        AND b.created_at >= :start
        AND b.created_at <  :end
    $q$
    ELSE $q$
      -- team: one row per answered customer turn (same definition as
      -- member_profile). occurred_at is when the CUSTOMER asked, so a
      -- slow answer lands in the bucket it was owed in.
      SELECT t.asked_at                  AS occurred_at,
             t.agent_id                  AS agent_id,
             c.channel                   AS channel,
             NULL::TEXT                  AS status,
             NULL::UUID                  AS pipeline_id,
             NULL::UUID                  AS stage_id,
             NULL::UUID                  AS broadcast_id,
             NULL::TEXT                  AS broadcast_name,
             NULL::NUMERIC               AS value,
             TRUE                        AS is_inbound,
             TRUE                        AS is_outbound,
             FALSE                       AS is_ai,
             FALSE                       AS is_delivered,
             FALSE                       AS is_read,
             FALSE                       AS is_failed,
             t.minutes                   AS resp_minutes,
             NULL::NUMERIC               AS days_to_close,
             NULL::INTEGER               AS recipients,
             NULL::INTEGER               AS sent_n,
             NULL::INTEGER               AS delivered_n,
             NULL::INTEGER               AS read_n,
             NULL::INTEGER               AS replied_n,
             NULL::INTEGER               AS failed_n,
             c.contact_id                AS contact_id,
             t.conversation_id           AS conversation_id,
             c.whatsapp_config_id        AS number_id
      FROM (
        SELECT s.conversation_id,
               s.created_at AS asked_at,
               r.sender_id  AS agent_id,
               extract(EPOCH FROM (r.created_at - s.created_at)) / 60.0 AS minutes
        FROM (
          SELECT m.conversation_id, m.created_at, m.sender_type,
                 lag(m.sender_type = 'customer') OVER (
                   PARTITION BY m.conversation_id ORDER BY m.created_at, m.id
                 ) AS prev_customer
          FROM messages m
          JOIN conversations c0 ON c0.id = m.conversation_id
          WHERE c0.account_id = :account
            AND m.created_at >= (:start)::TIMESTAMPTZ - interval '7 days'
            AND m.created_at <  :end
            AND (m.sender_type = 'customer'
                 OR (m.sender_type = 'agent' AND m.status <> 'failed'))
        ) s
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
        WHERE s.sender_type = 'customer'
          AND s.prev_customer IS NOT TRUE
          AND s.created_at >= :start
          AND s.created_at <  :end
      ) t
      JOIN conversations c ON c.id = t.conversation_id
    $q$
  END;

  -- Dynamic SQL cannot see plpgsql variables, so the three values every
  -- base query needs are inlined as quoted literals here — after the
  -- dataset was chosen, never from client text.
  v_base := replace(replace(replace(v_base_tpl,
    ':account', quote_literal(v_account)),
    ':start',   quote_literal(v_start)),
    ':end',     quote_literal(v_end));

  -- Comparison window: the equal-length period immediately before this one, so
  -- "this month vs last month" is the same number of days and a 31-day month
  -- cannot flatter itself against a 30-day one.
  IF v_compare THEN
    v_prev_end   := v_start;
    v_prev_start := v_start - (v_end - v_start);
    v_base_prev := replace(replace(replace(v_base_tpl,
      ':account', quote_literal(v_account)),
      ':start',   quote_literal(v_prev_start)),
      ':end',     quote_literal(v_prev_end));
  END IF;

  -- ---- optional joins (only when the report actually asks for them) ----
  IF v_need_tag THEN
    v_joins := v_joins || ' LEFT JOIN contact_tags ctag ON ctag.contact_id = b.contact_id'
                     || ' LEFT JOIN tags tg ON tg.id = ctag.tag_id';
  END IF;
  IF v_need_num THEN
    v_joins := v_joins || ' LEFT JOIN whatsapp_config wc ON wc.id = b.number_id';
  END IF;
  IF ('agent' = ANY(v_dims)) OR (v_filters ? 'agent') THEN
    v_joins := v_joins || ' LEFT JOIN profiles ap ON ap.user_id = b.agent_id';
  END IF;
  IF v_need_pip THEN
    v_joins := v_joins || ' LEFT JOIN pipelines pl ON pl.id = b.pipeline_id';
  END IF;
  IF v_need_stg THEN
    v_joins := v_joins || ' LEFT JOIN pipeline_stages st ON st.id = b.stage_id';
  END IF;

  -- ---- filters ---------------------------------------------------------
  -- Only the keys a dataset can honour are accepted; anything else raises,
  -- because a filter that silently does nothing is a wrong report.
  FOR v_key IN SELECT jsonb_object_keys(v_filters) LOOP
    CONTINUE WHEN v_key IN ('from', 'to', 'tz');  -- tolerated, handled above
    IF v_key = 'channel' AND v_dataset IN ('messages', 'conversations', 'contacts', 'team') THEN
      v_where := v_where || format(' AND b.channel = ANY(%L::TEXT[])',
        ARRAY(SELECT jsonb_array_elements_text(v_filters->'channel')));
    ELSIF v_key = 'status' AND v_dataset IN ('messages', 'conversations', 'deals', 'broadcasts') THEN
      v_where := v_where || format(' AND b.status = ANY(%L::TEXT[])',
        ARRAY(SELECT jsonb_array_elements_text(v_filters->'status')));
    ELSIF v_key = 'agent' AND v_dataset IN ('messages', 'conversations', 'deals', 'team') THEN
      v_where := v_where || format(' AND b.agent_id = ANY(%L::UUID[])',
        ARRAY(SELECT jsonb_array_elements_text(v_filters->'agent')));
    ELSIF v_key = 'tag' AND v_dataset IN ('messages', 'conversations', 'contacts', 'deals') THEN
      v_where := v_where || format(' AND ctag.tag_id = ANY(%L::UUID[])',
        ARRAY(SELECT jsonb_array_elements_text(v_filters->'tag')));
    ELSIF v_key = 'pipeline' AND v_dataset = 'deals' THEN
      v_where := v_where || format(' AND b.pipeline_id = ANY(%L::UUID[])',
        ARRAY(SELECT jsonb_array_elements_text(v_filters->'pipeline')));
    ELSIF v_key = 'stage' AND v_dataset = 'deals' THEN
      v_where := v_where || format(' AND b.stage_id = ANY(%L::UUID[])',
        ARRAY(SELECT jsonb_array_elements_text(v_filters->'stage')));
    ELSIF v_key = 'broadcast' AND v_dataset = 'broadcasts' THEN
      v_where := v_where || format(' AND b.broadcast_id = ANY(%L::UUID[])',
        ARRAY(SELECT jsonb_array_elements_text(v_filters->'broadcast')));
    ELSIF v_key = 'number' AND v_dataset IN ('messages', 'conversations', 'team') THEN
      v_where := v_where || format(' AND b.number_id = ANY(%L::UUID[])',
        ARRAY(SELECT jsonb_array_elements_text(v_filters->'number')));
    ELSE
      RAISE EXCEPTION 'filter "%" does not apply to the % dataset', v_key, v_dataset
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- ---- dimensions ------------------------------------------------------
  -- Per-dataset allowlist: `pipeline` on a messages report would join a
  -- table every row has as NULL and print one '—' row that looks like
  -- data. Rejecting the combination is the honest answer.
  v_dim_allow := CASE v_dataset
    WHEN 'messages'      THEN ARRAY['period', 'channel', 'agent', 'status', 'tag', 'number']
    WHEN 'conversations' THEN ARRAY['period', 'channel', 'agent', 'status', 'tag', 'number']
    WHEN 'contacts'      THEN ARRAY['period', 'channel', 'tag']
    WHEN 'deals'         THEN ARRAY['period', 'pipeline', 'stage', 'status', 'agent', 'tag']
    WHEN 'broadcasts'    THEN ARRAY['period', 'broadcast', 'status']
    ELSE                      ARRAY['period', 'agent', 'channel']
  END;

  FOREACH v_dim IN ARRAY v_dims LOOP
    IF NOT (v_dim = ANY(v_dim_allow)) THEN
      RAISE EXCEPTION 'dimension "%" does not apply to the % dataset', v_dim, v_dataset
        USING ERRCODE = '22023';
    END IF;

    v_expr := CASE v_dim
      WHEN 'period'    THEN format('date_trunc(%L, b.occurred_at AT TIME ZONE %L) AT TIME ZONE %L',
                                   v_grain, v_tz, v_tz)
      WHEN 'channel'   THEN 'b.channel'
      -- NULL means something different per dataset (a customer message, an
      -- unassigned conversation, a reply with no recorded member). The
      -- sentinel travels as-is and the UI/export translate it, so the report
      -- never prints a dash where a word belongs.
      WHEN 'agent'     THEN 'COALESCE(ap.full_name, ''__none'')'
      WHEN 'status'    THEN 'b.status'
      WHEN 'tag'       THEN 'COALESCE(tg.name, ''—'')'
      WHEN 'number'    THEN 'COALESCE(wc.display_phone_number, wc.verified_name, ''—'')'
      WHEN 'pipeline'  THEN 'COALESCE(pl.name, ''—'')'
      WHEN 'stage'     THEN 'COALESCE(st.name, ''—'')'
      WHEN 'broadcast' THEN 'COALESCE(b.broadcast_name, ''—'')'
    END;

    v_select := v_select || format('%s AS %I', v_expr, v_dim);
    v_columns := v_columns || jsonb_build_object('key', v_dim, 'kind',
      CASE WHEN v_dim = 'period' THEN 'time' ELSE 'text' END);
  END LOOP;

  -- ---- metrics ---------------------------------------------------------
  -- Each expression is written against the normalised base columns, so
  -- the same metric name can never mean two things across datasets.
  FOREACH v_metric IN ARRAY v_metrics LOOP
    v_expr := CASE v_dataset
      WHEN 'messages' THEN CASE v_metric
        WHEN 'messages'      THEN 'count(*)'
        WHEN 'inbound'       THEN 'count(*) FILTER (WHERE b.is_inbound)'
        WHEN 'outbound'      THEN 'count(*) FILTER (WHERE b.is_outbound)'
        WHEN 'ai_replies'    THEN 'count(*) FILTER (WHERE b.is_ai)'
        WHEN 'delivered'     THEN 'count(*) FILTER (WHERE b.is_delivered)'
        WHEN 'read'          THEN 'count(*) FILTER (WHERE b.is_read)'
        WHEN 'failed'        THEN 'count(*) FILTER (WHERE b.is_failed)'
        WHEN 'delivery_rate' THEN 'CASE WHEN count(*) FILTER (WHERE b.is_outbound) = 0 THEN NULL
                                        ELSE round(100.0 * count(*) FILTER (WHERE b.is_delivered)
                                                   / count(*) FILTER (WHERE b.is_outbound), 1) END'
      END
      WHEN 'conversations' THEN CASE v_metric
        WHEN 'conversations'      THEN 'count(*)'
        WHEN 'closed'             THEN 'count(*) FILTER (WHERE b.status = ''closed'')'
        WHEN 'open'               THEN 'count(*) FILTER (WHERE b.status <> ''closed'')'
        WHEN 'unassigned'         THEN 'count(*) FILTER (WHERE b.agent_id IS NULL)'
        WHEN 'with_reply'         THEN 'count(*) FILTER (WHERE b.resp_minutes IS NOT NULL)'
        WHEN 'first_response_avg' THEN 'round(avg(b.resp_minutes)::NUMERIC, 1)'
        WHEN 'days_to_close_avg'  THEN 'round(avg(b.days_to_close)::NUMERIC, 1)'
      END
      WHEN 'contacts' THEN CASE v_metric
        WHEN 'contacts'      THEN 'count(*)'
        WHEN 'with_tag'      THEN 'count(*) FILTER (WHERE ctag.tag_id IS NOT NULL)'
      END
      WHEN 'deals' THEN CASE v_metric
        WHEN 'deals'           THEN 'count(*)'
        WHEN 'won'             THEN 'count(*) FILTER (WHERE b.status = ''won'')'
        WHEN 'lost'            THEN 'count(*) FILTER (WHERE b.status = ''lost'')'
        WHEN 'active'          THEN 'count(*) FILTER (WHERE b.status NOT IN (''won'', ''lost''))'
        WHEN 'value'           THEN 'round(COALESCE(sum(b.value), 0)::NUMERIC, 2)'
        WHEN 'won_value'       THEN 'round(COALESCE(sum(b.value) FILTER (WHERE b.status = ''won''), 0)::NUMERIC, 2)'
        WHEN 'avg_value'       THEN 'round(avg(b.value)::NUMERIC, 2)'
        WHEN 'days_to_close_avg' THEN 'round(avg(b.days_to_close)::NUMERIC, 1)'
      END
      WHEN 'broadcasts' THEN CASE v_metric
        WHEN 'broadcasts'    THEN 'count(*)'
        WHEN 'recipients'    THEN 'COALESCE(sum(b.recipients), 0)'
        WHEN 'sent'          THEN 'COALESCE(sum(b.sent_n), 0)'
        WHEN 'delivered'     THEN 'COALESCE(sum(b.delivered_n), 0)'
        WHEN 'read'          THEN 'COALESCE(sum(b.read_n), 0)'
        WHEN 'replied'       THEN 'COALESCE(sum(b.replied_n), 0)'
        WHEN 'failed'        THEN 'COALESCE(sum(b.failed_n), 0)'
        WHEN 'read_rate'     THEN 'CASE WHEN COALESCE(sum(b.delivered_n), 0) = 0 THEN NULL
                                        ELSE round(100.0 * COALESCE(sum(b.read_n), 0)
                                                   / COALESCE(sum(b.delivered_n), 0), 1) END'
        WHEN 'reply_rate'    THEN 'CASE WHEN COALESCE(sum(b.delivered_n), 0) = 0 THEN NULL
                                        ELSE round(100.0 * COALESCE(sum(b.replied_n), 0)
                                                   / COALESCE(sum(b.delivered_n), 0), 1) END'
      END
      ELSE CASE v_metric
        WHEN 'replies'                THEN 'count(*)'
        WHEN 'conversations'          THEN 'count(DISTINCT b.conversation_id)'
        WHEN 'avg_response_minutes'   THEN 'round(avg(b.resp_minutes)::NUMERIC, 1)'
        WHEN 'median_response_minutes' THEN 'round(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.resp_minutes)::NUMERIC, 1)'
        WHEN 'p90_response_minutes'   THEN 'round(percentile_cont(0.9) WITHIN GROUP (ORDER BY b.resp_minutes)::NUMERIC, 1)'
        WHEN 'within_target'          THEN format('count(*) FILTER (WHERE b.resp_minutes <= %s)', v_target)
        WHEN 'within_target_rate'     THEN format(
          'CASE WHEN count(*) = 0 THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE b.resp_minutes <= %s) / count(*), 1) END',
          v_target)
      END
    END;

    IF v_expr IS NULL THEN
      RAISE EXCEPTION 'unknown metric "%" for the % dataset', v_metric, v_dataset
        USING ERRCODE = '22023';
    END IF;

    v_select := v_select || format('%s AS %I', v_expr, v_metric);
    v_metric_select := v_metric_select || format('%s AS %I', v_expr, v_metric);
    v_columns := v_columns || jsonb_build_object('key', v_metric, 'kind', 'number');
  END LOOP;

  v_group := CASE WHEN array_length(v_dims, 1) IS NULL THEN ''
                  ELSE ' GROUP BY ' || array_to_string(
                         ARRAY(SELECT g::TEXT FROM generate_series(1, array_length(v_dims, 1)) g), ', ')
                  END;

  -- A period breakdown reads oldest → newest; anything else (agent, tag,
  -- pipeline…) reads biggest first, because the question behind those
  -- reports is "who/what is on top".
  v_order := CASE
    WHEN array_length(v_dims, 1) IS NULL THEN ''
    WHEN v_dims[1] = 'period' THEN ' ORDER BY 1 ASC'
    ELSE format(' ORDER BY %s DESC', array_length(v_dims, 1) + 1)
  END;

  -- ---- rows ------------------------------------------------------------
  v_sql := format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) FROM (SELECT %s FROM (%s) b%s WHERE TRUE%s%s%s LIMIT %s) r',
    array_to_string(v_select, ', '),
    v_base,
    v_joins,
    v_where,
    v_group,
    v_order,
    -- one row past the cap: asking for exactly `limit` cannot tell
    -- "there were more" from "there were exactly this many".
    v_limit + 1
  );

  EXECUTE v_sql INTO v_rows;

  v_count := COALESCE(jsonb_array_length(v_rows), 0);
  IF v_count > v_limit THEN
    SELECT COALESCE(jsonb_agg(entry.value ORDER BY entry.ord), '[]'::jsonb)
      INTO v_rows
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS entry(value, ord)
    WHERE entry.ord <= v_limit;
    v_truncated := TRUE;
  END IF;

  -- ---- totals ----------------------------------------------------------
  -- Same metric expressions over the whole filtered set, deliberately NOT
  -- the sum of the rows: an average of averages is a wrong number, and the
  -- totals row is the one a manager quotes.
  EXECUTE format(
    'SELECT to_jsonb(r) FROM (SELECT %s FROM (%s) b%s WHERE TRUE%s) r',
    array_to_string(v_metric_select, ', '),
    v_base,
    v_joins,
    v_where
  ) INTO v_totals;

  IF v_compare THEN
    EXECUTE format(
      'SELECT to_jsonb(r) FROM (SELECT %s FROM (%s) b%s WHERE TRUE%s) r',
      array_to_string(v_metric_select, ', '),
      v_base_prev,
      v_joins,
      v_where
    ) INTO v_prev_totals;
  END IF;

  RETURN jsonb_build_object(
    'dataset',   v_dataset,
    'from',      v_from,
    'to',        v_to,
    'timeZone',  v_tz,
    'grain',     v_grain,
    'columns',   v_columns,
    'rows',      COALESCE(v_rows, '[]'::jsonb),
    'totals',    COALESCE(v_totals, '{}'::jsonb),
    'previous',  CASE WHEN v_compare THEN jsonb_build_object(
                   'from', v_prev_start,
                   'to',   v_prev_end,
                   'totals', COALESCE(v_prev_totals, '{}'::jsonb)
                 ) ELSE NULL END,
    'rowCount',  COALESCE(jsonb_array_length(v_rows), 0),
    'truncated', v_truncated,
    'limit',     v_limit
  );
END;
$$;

ALTER FUNCTION public._run_report(UUID, JSONB) OWNER TO postgres;
-- The account is a parameter here, so this one is for the service role only
-- (scheduled delivery). A tenant session must never reach it: it could name
-- somebody else's account.
REVOKE ALL ON FUNCTION public._run_report(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._run_report(UUID, JSONB) TO service_role;

-- The tenant-facing entry point: resolves the account from the session and
-- delegates, so there is one implementation of the aggregation.
CREATE OR REPLACE FUNCTION public.run_report(p_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT p.account_id INTO v_account
  FROM profiles p WHERE p.user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'caller is not a member of an account' USING ERRCODE = '42501';
  END IF;

  RETURN public._run_report(v_account, p_config);
END;
$$;

ALTER FUNCTION public.run_report(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.run_report(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_report(JSONB) TO authenticated;

-- ------------------------------------------------------------
-- redeem_invitation — 082 carries it forward only to register the new
-- account-scoped table. `saved_reports` IS domain data (a manager's saved
-- questions are part of the account), so joining another account with
-- saved reports present is refused, exactly like contacts or deals.
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
