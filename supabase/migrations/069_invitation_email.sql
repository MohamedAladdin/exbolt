-- ============================================================
-- 069_invitation_email
--
-- Invitations become addressable.
--
-- Until now an invitation was a bearer link and nothing else: the
-- admin copied the URL and handed it over, and the invitee had to
-- run through the full signup form (name + password + email
-- confirmation) before they could accept. That form only exists
-- while Supabase's own signups are enabled — on an instance that
-- runs with signups disabled (the common case for a private
-- tenant) every invitation to a *new* person died on
-- "Signups not allowed for this instance".
--
-- Storing the invitee's email lets the API pre-create the auth
-- user through GoTrue's admin invite endpoint and mail them a
-- one-click "set your password" link instead, so joining no
-- longer depends on public signup being open.
--
-- Nullable on purpose: link-only invites (hand the URL to someone
-- in WhatsApp) stay supported, and existing rows keep working.
-- ============================================================

ALTER TABLE public.account_invitations
  ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN public.account_invitations.email IS
  'Invitee email when the invite was addressed (null for link-only invites). Lower-cased at the API boundary.';

-- Guards the "invite the same person twice" mistake at the API
-- layer cheaply: a pending, unexpired invite for the same address
-- in the same account.
CREATE INDEX IF NOT EXISTS idx_account_invitations_pending_email
  ON public.account_invitations (account_id, lower(email))
  WHERE accepted_at IS NULL AND email IS NOT NULL;
