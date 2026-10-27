-- ============================================================
-- 066_message_edit_and_forward
--
-- Two inbox features that the WhatsApp Cloud API does not expose
-- directly, so the trail has to live in our own schema:
--
--   1. EDIT. Meta's Messages API has no edit (or delete) endpoint —
--      an official request is still open on the developer community.
--      What we can do honestly is:
--        * a message that FAILED (never left for the recipient) can be
--          replaced in place: same row, corrected text, new wamid, and
--          `edited_at` records that it was touched;
--        * a message that WAS delivered can only be followed by a
--          correction — a new message quoting the original. The
--          original keeps `edited_at` + `correction_message_id` so the
--          thread can show "صُحّحت" instead of pretending it changed.
--
--   2. FORWARD. No forward endpoint exists either; forwarding is
--      "send the same payload to another conversation". The new row
--      records `forwarded_from_message_id` (for the arrow marker) and
--      the source row counts `forward_count`.
--
-- All columns are nullable / defaulted, so old code against the new
-- schema stays safe. Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS correction_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forwarded_from_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forward_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_messages_correction
  ON messages(correction_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_forwarded_from
  ON messages(forwarded_from_message_id);

COMMENT ON COLUMN messages.edited_at IS
  'When this message''s text was replaced (failed send re-sent in place) or '
  'when a correction was issued for it. NULL means untouched.';

COMMENT ON COLUMN messages.correction_message_id IS
  'The follow-up message that corrects this one. Set on the ORIGINAL when a '
  'message that already reached WhatsApp had to be fixed — Meta has no edit '
  'endpoint, so a correction message is the only honest option.';

COMMENT ON COLUMN messages.forwarded_from_message_id IS
  'Source message this one was forwarded from (inbox "forward" action). '
  'Rendered as the forward marker, the way WhatsApp labels forwarded text.';

COMMENT ON COLUMN messages.forward_count IS
  'How many times this message has been forwarded through the inbox.';
