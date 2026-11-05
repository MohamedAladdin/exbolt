-- ============================================================
-- 108 — CONVERSATION OWNERSHIP · phase P4
--
-- "Who owns this thread?" used to be a manual act only: a manager assigns it,
-- or it stays in the shared queue forever. That is fine for a 3-person team and
-- breaks at 13 agents — everyone opens the queue, nobody owns the reply, and the
-- customer gets two answers (or none).
--
-- This migration makes ownership a *fact of behaviour*, not a policy document:
--   * auto-claim on first reply (default ON) — whoever answers owns it;
--   * auto-claim on first open (default OFF) — for teams where opening is
--     triage, not a commitment;
--   * `first_opened_by` is recorded ALWAYS, even when auto-claim is off. It
--     answers "who saw this first" without changing who owns it, and it is what
--     an "unanswered for 20 minutes" report needs.
--
-- The claim is one function so the web app, the inbox and (later) any automation
-- share one definition of "allowed to claim". Rules:
--   * the caller must be a member of the conversation's account, unblocked, and
--     hold a role in `accounts.auto_claim_roles`;
--   * never steal: a thread assigned to someone else stays theirs;
--   * the assignment goes through the existing trigger
--     `activity_conversations_assignment`, so the audit line is written without
--     new logging code — `claim_reason` tells the log WHY it moved.
--
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS auto_claim_on_reply BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_claim_on_open BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_claim_roles TEXT[] NOT NULL
    DEFAULT ARRAY['owner', 'admin', 'agent']::TEXT[];

COMMENT ON COLUMN public.accounts.auto_claim_on_reply IS
  'Whoever replies to an unassigned thread becomes its assignee.';
COMMENT ON COLUMN public.accounts.auto_claim_on_open IS
  'Opening an unassigned thread assigns it to the opener. Off by default: reading is not a commitment.';
COMMENT ON COLUMN public.accounts.auto_claim_roles IS
  'Roles allowed to take ownership. Viewers can read but never claim.';

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS first_opened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ,
  -- 'open' | 'reply' | 'manual' — why the thread moved to its current owner.
  ADD COLUMN IF NOT EXISTS claim_reason TEXT;

COMMENT ON COLUMN public.conversations.first_opened_by IS
  'Recorded on every first open, even when auto-claim is off. Never overwritten.';
COMMENT ON COLUMN public.conversations.claim_reason IS
  'open | reply | manual — the reason the thread was claimed.';

-- ------------------------------------------------------------
-- claim_conversation — the only writer of ownership from the app.
--
-- SECURITY DEFINER so the role check and the update are one atomic decision;
-- `auth.uid()` is still the caller, so the activity trigger logs the real actor.
-- Returns nothing: callers that need to know the owner re-read the row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_conversation(
  p_conversation UUID,
  p_reason TEXT DEFAULT 'open'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_account FROM public.accounts WHERE id = v_conv.account_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.user_id = v_uid
       AND p.account_id = v_conv.account_id
       AND p.blocked_at IS NULL
       AND p.account_role::text = ANY (v_account.auto_claim_roles)
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RETURN;
  END IF;

  -- First-open telemetry is unconditional: it is a fact, not a policy.
  IF p_reason = 'open' THEN
    UPDATE public.conversations
       SET first_opened_by = COALESCE(first_opened_by, v_uid),
           first_opened_at = COALESCE(first_opened_at, now())
     WHERE id = p_conversation;
  END IF;

  IF p_reason = 'open' AND NOT v_account.auto_claim_on_open THEN
    RETURN;
  END IF;
  IF p_reason = 'reply' AND NOT v_account.auto_claim_on_reply THEN
    RETURN;
  END IF;
  IF p_reason NOT IN ('open', 'reply', 'manual') THEN
    RETURN;
  END IF;

  -- Never steal a thread from a colleague.
  IF v_conv.assigned_agent_id IS NOT NULL AND v_conv.assigned_agent_id <> v_uid THEN
    RETURN;
  END IF;

  UPDATE public.conversations
     SET assigned_agent_id = v_uid,
         claim_reason = p_reason
   WHERE id = p_conversation
     AND (assigned_agent_id IS NULL OR assigned_agent_id = v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_conversation(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_conversation(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.claim_conversation(UUID, TEXT) IS
  'Claim an unassigned thread for the caller. Respects role gate, auto-claim settings, and never steals.';

-- The "who is sitting on an unanswered thread" report reads this.
CREATE INDEX IF NOT EXISTS idx_conversations_first_opened
  ON public.conversations(first_opened_by)
  WHERE first_opened_by IS NOT NULL;
