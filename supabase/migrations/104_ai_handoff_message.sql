-- A handoff that sends nothing is indistinguishable, from the customer's side,
-- from being ignored. Let an account choose the line that goes out at the
-- moment the bot steps aside:
--   NULL  → stay silent (today's behaviour; nothing changes for existing rows)
--   text  → send it, then mute the thread and alert the humans
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS handoff_message TEXT;

COMMENT ON COLUMN public.ai_configs.handoff_message IS
  'Optional message sent to the customer when the assistant hands the conversation to a human. NULL = send nothing (silent handoff).';
