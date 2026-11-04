-- 095 — business hours: response time that counts real working time
--
-- "هدف زمن الرد" was measured as raw wall-clock minutes, so a message that
-- arrived Friday at 18:00 and was answered Saturday at 09:00 scored 900
-- minutes against the agent. The manager needs the honest number: minutes
-- inside the account's working window only.
--
-- Off by default (`business_hours_enabled = false`), and every existing metric
-- keeps its current meaning until the account opts in — nothing changes for
-- anyone who never opens the setting.
--
-- `business_days` uses `extract(dow)` numbering: 0 = Sunday … 6 = Saturday.
-- The default (Sun–Thu) is the Egyptian working week.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS business_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_hours_start   TIME    NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS business_hours_end     TIME    NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS business_days          SMALLINT[] NOT NULL DEFAULT '{0,1,2,3,4}',
  ADD COLUMN IF NOT EXISTS business_timezone      TEXT    NOT NULL DEFAULT 'Africa/Cairo';

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_business_hours_range;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_business_hours_range
  CHECK (business_hours_start < business_hours_end);

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_business_days_valid;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_business_days_valid
  CHECK (business_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]);

COMMENT ON COLUMN public.accounts.business_days IS
  'Working days with extract(dow) numbering: 0 = Sunday … 6 = Saturday';
COMMENT ON COLUMN public.accounts.business_hours_enabled IS
  'When true, response-time metrics count only minutes inside the working window';

-- ============================================================
-- The measurement
-- ============================================================
-- Returns the number of WORKING minutes between two instants. Falls back to
-- plain elapsed minutes whenever the window is unusable (disabled, no days,
-- inverted hours) or the timestamps are missing/backwards — a metric must
-- never return NULL because a setting was half-configured.
CREATE OR REPLACE FUNCTION public.business_minutes(
  p_from    TIMESTAMPTZ,
  p_to      TIMESTAMPTZ,
  p_tz      TEXT,
  p_start   TIME,
  p_end     TIME,
  p_days    SMALLINT[],
  p_enabled BOOLEAN
) RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN NULL
    WHEN NOT COALESCE(p_enabled, false)
      OR p_start IS NULL OR p_end IS NULL
      OR p_start >= p_end
      OR COALESCE(array_length(p_days, 1), 0) = 0
    THEN round(extract(EPOCH FROM (p_to - p_from)) / 60.0, 2)
    ELSE (
      SELECT COALESCE(sum(GREATEST(
               0,
               extract(EPOCH FROM (LEAST(p_to, w.win_end) - GREATEST(p_from, w.win_start))) / 60.0
             )), 0)
      FROM (
        SELECT d::DATE                                                AS day,
               ((d::DATE)::TIMESTAMP + p_start) AT TIME ZONE p_tz      AS win_start,
               ((d::DATE)::TIMESTAMP + p_end)   AT TIME ZONE p_tz      AS win_end
        FROM generate_series(
               (p_from AT TIME ZONE p_tz)::DATE,
               (p_to   AT TIME ZONE p_tz)::DATE,
               interval '1 day'
             ) AS d
      ) w
      WHERE extract(dow FROM w.day)::SMALLINT = ANY (p_days)
    )
  END;
$$;

COMMENT ON FUNCTION public.business_minutes(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TIME, TIME, SMALLINT[], BOOLEAN) IS
  'Working minutes between two instants; plain elapsed minutes when business hours are disabled or unusable';

ALTER FUNCTION public.business_minutes(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TIME, TIME, SMALLINT[], BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.business_minutes(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TIME, TIME, SMALLINT[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_minutes(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TIME, TIME, SMALLINT[], BOOLEAN) TO authenticated;
