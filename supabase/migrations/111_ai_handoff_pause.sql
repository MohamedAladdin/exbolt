-- A handoff used to mute the thread forever (`ai_autoreply_disabled = true`
-- with no way back except a human clicking «استئناف»). In production that
-- left 37 WhatsApp threads answering nothing while the customer kept
-- writing. The assistant now pauses for a bounded window and resumes by
-- itself when nobody takes the thread over.
--
-- NULL means "no scheduled resume" — a human paused it from the inbox
-- banner, and only a human may undo that.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_paused_until timestamptz;

COMMENT ON COLUMN public.conversations.ai_paused_until IS
  'When ai_autoreply_disabled was set by a handoff: the assistant resumes after this instant if no agent took the thread. NULL = paused by a human (never auto-resumes).';
