-- 103 — how much of the thread the assistant reads per reply.
--
-- Every inbound message is a fresh provider request: the system prompt
-- (instructions + knowledge excerpts) plus the last N text messages. N was a
-- deployment-wide env value (`AI_CONTEXT_MESSAGE_LIMIT`, default 20), which is
-- the wrong shape: a two-line booking exchange and a long clinical back-and-forth
-- want different windows, and only the account can tell which is which.
--
-- Range is clamped: below 4 the model loses the question, above 50 the input
-- cost per reply (and the latency) outgrow the benefit.

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS context_message_limit INTEGER NOT NULL DEFAULT 20;

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_context_message_limit_check;
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_context_message_limit_check
  CHECK (context_message_limit BETWEEN 4 AND 50);

COMMENT ON COLUMN public.ai_configs.context_message_limit IS
  'How many recent text messages of the thread are sent with each reply (4–50). Fewer = cheaper and faster, less context.';
