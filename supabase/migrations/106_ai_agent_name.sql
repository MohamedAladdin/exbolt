-- 106 — the assistant gets a name of its own.
--
-- The outgoing signature (`accounts.signature_template`, 105) renders
-- `{{ agent_name }}` as *who is speaking*. For a message a teammate typed that
-- is their own name, but the AI agent's replies were resolved through
-- `ai_configs.created_by` / the account owner — so a clinic's bot signed its
-- replies with the doctor's personal name, which is wrong on both counts: the
-- customer is talking to the assistant, and the owner never agreed to have
-- their name on it.
--
-- The assistant's identity belongs on `ai_configs`, next to its persona:
--   * NULL (default) — the assistant's replies go out unsigned. It does NOT
--     fall back to the account name: that name is very often a person's (the
--     account this was reported on is called «3amer»), and a bot signing with
--     it is the same complaint one step removed,
--   * any text — what the bot signs with, e.g. «مساعد هيموكيور».
--
-- Nothing is backfilled: a tenant that never opens the field keeps the
-- behaviour introduced by 105 (account name) rather than inheriting a guess.

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- A name is a name: 60 chars fits «مساعد عيادة …» comfortably, and anything
-- longer is a sentence typed into the wrong box — a signature appended to
-- every single reply.
ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_agent_name_length;
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_agent_name_length
  CHECK (agent_name IS NULL OR char_length(agent_name) <= 60);

COMMENT ON COLUMN public.ai_configs.agent_name IS
  'Display name the assistant signs its replies with ({{ agent_name }} in accounts.signature_template). NULL = its replies carry no signature at all.';
