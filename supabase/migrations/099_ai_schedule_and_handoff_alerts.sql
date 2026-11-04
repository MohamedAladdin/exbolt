-- 099 — the assistant gets its own working window, and a handoff never
-- lands in silence.
--
-- 1) AI SCHEDULE (per AI config, independent of the inbox window)
--    `accounts.business_hours_*` (095) describes the team's working week and
--    feeds the response-time metric — it says when *agents* are on duty, and
--    it must keep that one meaning. The assistant needs its own window: a
--    clinic can let the assistant answer Sun–Sat 10:00–22:00 while the team
--    itself works Sun–Thu 09:00–21:00. So the schedule lives on `ai_configs`,
--    with its own enable flag.
--
--    Off by default (`ai_schedule_enabled = false`), and `outside_hours_mode`
--    defaults to `always` — deploying this changes the behaviour of exactly
--    zero accounts until somebody opens the screen and chooses.
--
-- 2) HANDOFF ALERT
--    A handoff with no target lands in the shared queue and, until now,
--    nobody was told: the customer waiting, the thread unassigned, no
--    notification anywhere. `ai_handoff_unassigned` is the notification type
--    the app raises to every owner/admin/agent of the account.

-- ============================================================
-- AI schedule + outside-hours policy
-- ============================================================
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS ai_schedule_enabled  BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_schedule_start    TIME         NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS ai_schedule_end      TIME         NOT NULL DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS ai_schedule_days     SMALLINT[]   NOT NULL DEFAULT '{0,1,2,3,4}',
  ADD COLUMN IF NOT EXISTS ai_schedule_timezone TEXT         NOT NULL DEFAULT 'Africa/Cairo',
  ADD COLUMN IF NOT EXISTS outside_hours_mode   TEXT         NOT NULL DEFAULT 'always',
  ADD COLUMN IF NOT EXISTS outside_hours_message TEXT;

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_schedule_range;
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_schedule_range
  CHECK (ai_schedule_start < ai_schedule_end);

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_schedule_days_valid;
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_schedule_days_valid
  CHECK (ai_schedule_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]);

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_outside_hours_mode_check;
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_outside_hours_mode_check
  CHECK (outside_hours_mode IN ('always', 'silent', 'message'));

COMMENT ON COLUMN public.ai_configs.ai_schedule_days IS
  'Assistant working days, extract(dow) numbering: 0 = Sunday … 6 = Saturday. Independent of accounts.business_days (which only feeds the response-time metric).';
COMMENT ON COLUMN public.ai_configs.ai_schedule_enabled IS
  'When true, outside_hours_mode decides what the auto-reply does outside this window';
COMMENT ON COLUMN public.ai_configs.outside_hours_mode IS
  'Outside the AI schedule: always | silent | message';
COMMENT ON COLUMN public.ai_configs.outside_hours_message IS
  'Canned reply sent once per thread outside the AI schedule (mode = message)';

-- One "we're closed" reply per thread per cooldown — the column records the
-- last time it went out, so a burst of messages doesn't earn a burst of
-- identical replies.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS outside_hours_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.conversations.outside_hours_notified_at IS
  'Last time the away message was sent on this thread (cooldown throttle)';

-- ============================================================
-- NOTIFICATION TYPE for an unassigned AI handoff
-- ============================================================
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'report_alert', 'ai_handoff_unassigned'));
