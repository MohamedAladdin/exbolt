-- ============================================================
-- 105 — PUSH SUBSCRIPTIONS (Web Push / VAPID) · phase P1
--
-- One row per device per account. The row holds the capability URL
-- the browser's push service gave us plus the two keys web-push needs
-- to encrypt the payload for that device.
--
-- Why a table and not localStorage like the in-tab alerts: a push is
-- sent by the server, hours later, to a browser that may not be open.
-- The server has to know the device exists.
--
-- Deliberately NOT in this migration (later phases, see the plan):
--   * notification_preferences  — P2/P5
--   * push_outbox + triggers    — P3
--   * conversation ownership    — P4
--
-- Idempotent: safe to re-run (`IF NOT EXISTS` everywhere), so applying
-- it twice on a box without a migration ledger cannot fail.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- Recipient. A subscription belongs to a person, not to an account:
  -- two colleagues never share one browser profile's push channel.
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Capability URL from the push service (FCM / Mozilla / WNS / APNs).
  -- Treat as a secret: it is enough to send a notification to that device.
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- The locale the device asked for, so the payload can be rendered in
  -- Arabic or English per device rather than per deployment.
  locale TEXT NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Delivery health, bumped by the sender. A device that keeps returning
  -- 404/410 is deleted; other failures are surfaced in Settings → الأجهزة.
  failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  -- Scoped to the tenant, not globally: the same browser profile can hold
  -- a subscription per account if membership ever becomes multi-account.
  CONSTRAINT push_subscriptions_account_endpoint_key UNIQUE (account_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account
  ON public.push_subscriptions(account_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A user manages their own devices only. No policy for anyone else: the
-- sender uses the service-role key and is not affected by RLS.
DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_insert ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_update ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_delete ON public.push_subscriptions;

CREATE POLICY push_subscriptions_select ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY push_subscriptions_insert ON public.push_subscriptions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid() AND p.account_id = push_subscriptions.account_id
    )
  );

CREATE POLICY push_subscriptions_update ON public.push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY push_subscriptions_delete ON public.push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE public.push_subscriptions IS
  'Web Push (VAPID) device subscriptions. Created by /api/push/subscribe, read by the push sender with the service-role key.';
