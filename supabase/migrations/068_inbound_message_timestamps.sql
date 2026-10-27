-- 068_inbound_message_timestamps.sql
--
-- Bug this fixes: `persistEvent` (src/lib/channels/process-inbound.ts) inserted
-- inbound messages without `created_at`, so every row took the DB default
-- `now()`. That is invisible for webhook deliveries (they arrive within a
-- second of the message) but wrong for the Graph poller added in
-- `src/lib/channels/poll-inbox.ts`, which backfills history: old conversations
-- were written with a current timestamp and then pushed to the top of the inbox
-- by `bump_conversation_on_inbound`, whose `last_message_at = NOW()` is
-- unconditional.
--
-- The new function takes the message's own timestamp and only bumps the
-- unread counter when this really is the newest message, so backfill cannot
-- reorder the inbox or invent unread badges.

CREATE OR REPLACE FUNCTION public.bump_conversation_on_inbound_at(
  p_conversation_id UUID,
  p_last_message_text TEXT,
  p_at TIMESTAMPTZ,
  p_count_unread BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET unread_count      = COALESCE(unread_count, 0) + CASE WHEN p_count_unread THEN 1 ELSE 0 END,
      last_message_text = CASE WHEN p_count_unread THEN p_last_message_text ELSE last_message_text END,
      last_message_at   = GREATEST(COALESCE(last_message_at, p_at), p_at),
      updated_at        = NOW()
  WHERE id = p_conversation_id;
$$;

REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound_at(UUID, TEXT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound_at(UUID, TEXT, TIMESTAMPTZ, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound_at(UUID, TEXT, TIMESTAMPTZ, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bump_conversation_on_inbound_at(UUID, TEXT, TIMESTAMPTZ, BOOLEAN) TO service_role;
