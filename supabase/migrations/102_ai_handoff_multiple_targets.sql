-- 102 — a handoff can name several people, not one.
--
-- `handoff_agent_id` held a single agent: a clinic with a duty rota could only
-- alert whoever was configured the day it was set. `handoff_agent_ids` is the
-- real list — everyone who should be pinged when the assistant gives up.
--
-- The thread is still *assigned* to one person (a conversation has a single
-- `assigned_agent_id`); the rest are notified. That keeps the inbox honest
-- about who owns it while nobody misses the alert.
--
-- `handoff_agent_id` stays for one release as a legacy read-only column (old
-- code paths and a rolled-back deploy keep working); nothing writes it now.

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS handoff_agent_ids UUID[] NOT NULL DEFAULT '{}';

-- Backfill from the single-target column, once.
UPDATE public.ai_configs
SET handoff_agent_ids = ARRAY[handoff_agent_id]
WHERE handoff_agent_id IS NOT NULL
  AND (handoff_agent_ids IS NULL OR cardinality(handoff_agent_ids) = 0);

COMMENT ON COLUMN public.ai_configs.handoff_agent_ids IS
  'Agents alerted when the assistant hands a thread off. One is assigned, all are notified. Empty = notify every owner/admin/agent.';
COMMENT ON COLUMN public.ai_configs.handoff_agent_id IS
  'Legacy single target (migration 102 moved to handoff_agent_ids). Read-only.';
