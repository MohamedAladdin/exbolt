-- 090 — automatic conversation status (open → pending → closed)
--
-- Two new facts the inbox needs before a cron can retire threads on its own:
--
--  1. `conversations.status_auto` — who moved the status. The sweep writes
--     `true`; a human, an inbound message or a reopen writes `false`. Without
--     it `closed` stops meaning "resolved by a person" and `days_to_close_avg`
--     silently becomes "days of silence".
--
--  2. `accounts.auto_close_after_days` — the close threshold lives on the
--     account (default 7), never hardcoded in the job.
--
-- It also closes the black hole the statuses would otherwise open: a thread
-- hidden behind `pending`/`closed` must come back by itself, otherwise a
-- customer's reply lands in a thread nobody is looking at. The inbound path
-- never reopened anything before this migration.
--
-- The reopen rules are deliberately asymmetric:
--   • customer inbound            → open (from pending AND closed)  — this is
--     the only thing that actually reopens Meta's 24h free-form window.
--   • an outbound agent/bot send  → open from CLOSED only. Sending a template
--     does NOT reopen the 24h window (only the customer's reply does), so a
--     pending thread stays pending after the template — flipping it to "open"
--     there would invite free-form text that Meta rejects with 131047.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS status_auto BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conversations.status_auto IS
  'true when the auto-status sweep set conversations.status; false when a human, an inbound message or a reopen set it';

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS auto_close_after_days INTEGER NOT NULL DEFAULT 7;

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_auto_close_after_days_range;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_auto_close_after_days_range
  CHECK (auto_close_after_days BETWEEN 1 AND 90);

-- ============================================================
-- Reopen on the message stream
-- ============================================================
-- `last_message_at` is stamped here as well: the sweep decides "idle" from it,
-- so a thread that just received a message must not carry a month-old
-- timestamp — otherwise a reopened thread reads as idle again and the very next
-- sweep closes it back, seconds after the agent rescued it.
CREATE OR REPLACE FUNCTION public.reopen_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'customer' THEN
    UPDATE conversations
    SET status = 'open',
        status_auto = false,
        last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at)
    WHERE id = NEW.conversation_id
      AND status <> 'open';
  ELSIF (NEW.sender_type IN ('agent', 'bot') OR NEW.ai_generated)
        AND NEW.status IS DISTINCT FROM 'failed' THEN
    UPDATE conversations
    SET status = 'open',
        status_auto = false,
        last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at)
    WHERE id = NEW.conversation_id
      AND status = 'closed';
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.reopen_conversation_on_message() OWNER TO postgres;

DROP TRIGGER IF EXISTS reopen_conversation_on_message ON public.messages;

CREATE TRIGGER reopen_conversation_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.reopen_conversation_on_message();

REVOKE ALL ON FUNCTION public.reopen_conversation_on_message() FROM PUBLIC;
