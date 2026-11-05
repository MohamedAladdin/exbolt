-- ============================================================
-- 106 — NOTIFICATION PREFERENCES · phase P2
--
-- One row per user (a user belongs to exactly one account: `profiles.user_id`
-- carries a UNIQUE constraint, verified on the live box).
--
-- Two channel masters and four type switches, because "which alerts" and
-- "where they land" are different questions: an agent may want the in-app
-- popup all day and no OS banners while they are at their desk.
--
-- The record itself — a `notifications` row, the sidebar badge and the
-- /notifications list — is never gated by these switches. Turning both
-- channels off must leave a complete history behind, not erase events.
--
-- Privacy and quiet hours live here from the start so the API has one shape;
-- the UI for them arrives with P5.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

  -- Channels
  in_app_alerts BOOLEAN NOT NULL DEFAULT true,   -- popup + desktop alert while the app is open
  push_enabled BOOLEAN NOT NULL DEFAULT true,    -- out-of-app Web Push (gates the outbox in P3)

  -- Alerts (types). They gate every channel, not just push.
  customer_message BOOLEAN NOT NULL DEFAULT true,
  conversation_assigned BOOLEAN NOT NULL DEFAULT true,
  ai_handoff BOOLEAN NOT NULL DEFAULT true,
  report_alert BOOLEAN NOT NULL DEFAULT true,

  -- 'none' hides the contact name and the text on a lock screen; 'name' is the
  -- default because "رسالة من أحمد" is useful while "عايز أعرف سعر الكشف" is not
  -- something a clinic wants visible on a shared desk.
  push_preview TEXT NOT NULL DEFAULT 'name' CHECK (push_preview IN ('none', 'name', 'full')),

  -- Quiet hours suppress push only; the in-app popup keeps working for whoever
  -- is at the desk at 23:00. NULL/NULL = off.
  quiet_from TIME,
  quiet_to TIME,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_account
  ON public.notification_preferences(account_id);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_select ON public.notification_preferences;
DROP POLICY IF EXISTS notification_preferences_insert ON public.notification_preferences;
DROP POLICY IF EXISTS notification_preferences_update ON public.notification_preferences;
DROP POLICY IF EXISTS notification_preferences_delete ON public.notification_preferences;

CREATE POLICY notification_preferences_select ON public.notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY notification_preferences_insert ON public.notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY notification_preferences_update ON public.notification_preferences
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY notification_preferences_delete ON public.notification_preferences
  FOR DELETE USING (auth.uid() = user_id);

-- Reuse the shared updated_at trigger function (migration 001).
DROP TRIGGER IF EXISTS set_updated_at ON public.notification_preferences;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.notification_preferences IS
  'Per-user alert preferences: channel masters, type switches, lock-screen preview, quiet hours.';
