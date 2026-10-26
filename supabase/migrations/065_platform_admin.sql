-- ============================================================
-- 065_platform_admin
--
-- Everything the Super-Admin panel needs, and nothing the tenant
-- app should ever touch:
--
--   platform_admins      — who may open /admin (service-role gated)
--   platform_settings    — one row: registration open/closed, mail
--                          identity, reminder policy, maintenance
--   signup_allowlist     — the only door into auth.users while
--                          registration is closed (or invite-only)
--   accounts.status      — active / suspended / archived / banned
--   profiles.blocked_*   — per-USER block, independent of the tenant
--   account_grants       — gifts: feature, limit, trial extension,
--                          discount, credit (expiry-aware)
--   invoices             — issued to a tenant, emailed, reminded
--   outbound_emails      — every message we send, with its outcome
--   admin_audit_log      — every privileged action, append-only
--
-- Security model: every table here is SERVICE-ROLE ONLY. RLS is
-- enabled with no policies, so an anon/authenticated client sees
-- nothing; the admin API reaches them through the service key only
-- after verifying the caller against `platform_admins`.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Who is a platform admin
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID
);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- Deliberately no policies: service role only.

-- Used by RLS policies elsewhere and by the app to avoid a second
-- round trip. SECURITY DEFINER so it can read the table above.
CREATE OR REPLACE FUNCTION public.is_platform_admin(uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = uid)
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated, anon;

-- ------------------------------------------------------------
-- 2. Platform settings (singleton)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_settings (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Registration gate. `signup_mode` wins when it is not 'open':
  --   open        → anyone may sign up
  --   invite_only → only emails on signup_allowlist (or with a pending
  --                 team invitation) may complete signup
  --   closed      → nobody, same allowlist exception
  signup_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  signup_mode           TEXT NOT NULL DEFAULT 'open'
                          CHECK (signup_mode IN ('open', 'invite_only', 'closed')),
  signup_closed_message TEXT,
  maintenance_mode      BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_message   TEXT,
  -- Mail identity used for invoices / reminders / customer email.
  support_email         TEXT,
  billing_from_name     TEXT NOT NULL DEFAULT 'EXCAL LABS',
  billing_from_email    TEXT,
  billing_reply_to      TEXT,
  -- Reminder policy for unpaid invoices.
  reminder_days_before  INTEGER NOT NULL DEFAULT 3 CHECK (reminder_days_before >= 0),
  grace_days            INTEGER NOT NULL DEFAULT 7 CHECK (grace_days >= 0),
  currency              TEXT NOT NULL DEFAULT 'USD',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            UUID
);

INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS set_updated_at ON platform_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 3. Signup allowlist — the only door while registration is closed
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signup_allowlist (
  email       TEXT PRIMARY KEY CHECK (email = lower(email)),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  used_at     TIMESTAMPTZ,
  used_by     UUID
);

ALTER TABLE signup_allowlist ENABLE ROW LEVEL SECURITY;

-- The gate: BEFORE INSERT on auth.users, so a raw `POST /auth/v1/signup`
-- with the public anon key is refused too — not just the /signup form.
CREATE OR REPLACE FUNCTION public.enforce_signup_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email    TEXT := lower(COALESCE(NEW.email, ''));
  v_settings platform_settings;
BEGIN
  SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
  -- Unconfigured install: never lock the operator out of their own app.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_settings.signup_enabled AND v_settings.signup_mode = 'open' THEN
    RETURN NEW;
  END IF;

  -- Closed / invite-only: an explicit allowlist entry opens the door once.
  IF EXISTS (
    SELECT 1 FROM signup_allowlist
    WHERE email = v_email
      AND used_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
  ) THEN
    UPDATE signup_allowlist
       SET used_at = NOW(), used_by = NEW.id
     WHERE email = v_email AND used_at IS NULL;
    RETURN NEW;
  END IF;

  -- NOTE: team invitations do NOT carry an email address (only a free-text
  -- `label`), so they cannot open this door without guessing. When
  -- registration is closed, an invited teammate is added to the allowlist
  -- from the panel — that is one click and needs no schema change.

  RAISE EXCEPTION 'SIGNUP_CLOSED'
    USING ERRCODE = 'check_violation',
          HINT = 'Registration is disabled on this platform.';
END;
$$;

DROP TRIGGER IF EXISTS enforce_signup_gate ON auth.users;
CREATE TRIGGER enforce_signup_gate
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_signup_gate();

-- ------------------------------------------------------------
-- 4. Tenant lifecycle: accounts.status
-- ------------------------------------------------------------
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_status_check'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_status_check
      CHECK (status IN ('active', 'suspended', 'archived', 'banned'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts (status);

-- ------------------------------------------------------------
-- 5. Per-user block (a person, not a tenant)
-- ------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_blocked
  ON profiles (blocked_at) WHERE blocked_at IS NOT NULL;

-- ------------------------------------------------------------
-- 6. Grants & gifts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_grants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL
                     CHECK (kind IN ('feature', 'limit', 'plan_upgrade', 'trial_extension', 'discount', 'credit')),
  -- feature code / limit key for the first two kinds; NULL otherwise.
  key              TEXT,
  -- true/false for feature grants, a number for limit grants,
  -- { months } for trial_extension, { percent } for discount,
  -- { amount, currency } for credit.
  value            JSONB NOT NULL DEFAULT 'true'::jsonb,
  reason           TEXT,
  expires_at       TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  granted_by       UUID,
  granted_by_email TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_grants_account
  ON account_grants (account_id, created_at DESC);

ALTER TABLE account_grants ENABLE ROW LEVEL SECURITY;

-- A tenant may READ its own grants (so the plan page can say "this was
-- given to you"), never write them. Writes are service-role only.
DROP POLICY IF EXISTS account_grants_select ON account_grants;
CREATE POLICY account_grants_select ON account_grants FOR SELECT
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- 7. Invoices
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           TEXT NOT NULL UNIQUE,
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')),
  currency         TEXT NOT NULL DEFAULT 'USD',
  amount           NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  tax              NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE NOT NULL DEFAULT (CURRENT_DATE + 7),
  period_start     DATE,
  period_end       DATE,
  plan_code        TEXT,
  -- [{ description, quantity, unit_price }]
  line_items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes            TEXT,
  to_email         TEXT,
  to_name          TEXT,
  sent_at          TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  last_reminder_at TIMESTAMPTZ,
  reminders_sent   INTEGER NOT NULL DEFAULT 0,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_account ON invoices (account_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_open
  ON invoices (due_date) WHERE status IN ('sent', 'overdue');

DROP TRIGGER IF EXISTS set_updated_at ON invoices;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 8. Outbound email log (the panel's "what did we actually send?")
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_emails (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID REFERENCES accounts(id) ON DELETE SET NULL,
  invoice_id          UUID REFERENCES invoices(id) ON DELETE SET NULL,
  kind                TEXT NOT NULL
                        CHECK (kind IN ('invoice', 'reminder', 'receipt', 'welcome', 'custom', 'test')),
  to_email            TEXT NOT NULL,
  subject             TEXT NOT NULL,
  body_text           TEXT NOT NULL,
  body_html           TEXT,
  -- dry_run = rendered and logged, not transmitted (no SMTP configured)
  status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'sent', 'failed', 'dry_run')),
  provider            TEXT,
  provider_message_id TEXT,
  error               TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID
);

CREATE INDEX IF NOT EXISTS idx_outbound_emails_created
  ON outbound_emails (created_at DESC);

ALTER TABLE outbound_emails ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 9. Audit log — append-only, service role only
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id UUID,
  actor_email   TEXT,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  target_label  TEXT,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
  ON admin_audit_log (created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 10. Connection health (Facebook / Instagram / WhatsApp tokens)
--
-- Cloud API user tokens minted through the OAuth wizard expire in
-- ~60 days and simply stop working: the tenant sees "sending fails"
-- with no clue. `token_expires_at` lets the panel warn before that
-- happens, and `last_error` keeps the last Graph failure visible to
-- the operator instead of only in the server log.
-- ------------------------------------------------------------
ALTER TABLE whatsapp_config  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE whatsapp_config  ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE channel_configs  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE channel_configs  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- ------------------------------------------------------------
-- 11. Aggregates for the accounts table
--
-- One round trip instead of N+1 from the panel (PostgREST has no
-- GROUP BY). Invoker rights + service_role only: RLS is bypassed for
-- the admin client, and an authenticated caller cannot reach it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_account_stats()
RETURNS TABLE (
  account_id     UUID,
  members        INTEGER,
  contacts       INTEGER,
  conversations  INTEGER,
  messages_30d   INTEGER,
  channels       INTEGER,
  last_activity  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    a.id,
    (SELECT count(*)::int FROM profiles p WHERE p.account_id = a.id),
    (SELECT count(*)::int FROM contacts c WHERE c.account_id = a.id),
    (SELECT count(*)::int FROM conversations v WHERE v.account_id = a.id),
    (SELECT count(*)::int
       FROM messages m
       JOIN conversations v ON v.id = m.conversation_id
      WHERE v.account_id = a.id
        AND m.created_at > NOW() - INTERVAL '30 days'),
    ((SELECT count(*)::int FROM channel_configs cc
       WHERE cc.account_id = a.id AND cc.is_active)
     + (SELECT count(*)::int FROM whatsapp_config w
         WHERE w.account_id = a.id AND w.status = 'connected')),
    (SELECT max(v.last_message_at) FROM conversations v WHERE v.account_id = a.id)
  FROM accounts a
$$;

REVOKE ALL ON FUNCTION public.admin_account_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_account_stats() TO service_role;

-- ------------------------------------------------------------
-- 12. Comments (documentation that lives with the schema)
-- ------------------------------------------------------------
COMMENT ON TABLE platform_admins IS
  'Users allowed into /admin. Checked server-side on every admin request; the panel then uses the service role.';
COMMENT ON COLUMN accounts.status IS
  'active = normal; suspended = locked out until restored; archived = read-only/hidden; banned = locked out permanently.';
COMMENT ON TABLE account_grants IS
  'Gifts layered on top of the plan: feature/limit/trial extension/discount/credit, with expiry.';
COMMENT ON COLUMN outbound_emails.status IS
  'dry_run means SMTP is not configured: the message is rendered and logged but not transmitted.';

-- ------------------------------------------------------------
-- 13. redeem_invitation — the second-hop guard
--
-- 065 adds three account-scoped tables (account_grants, invoices,
-- outbound_emails). Accepting a team invitation deletes the caller's old
-- personal account, so each of them must be listed here or a live grant /
-- invoice silently cascades away. Same body as 064 plus the three lines.
--
-- `src/lib/auth/redeem-invitation-migration.test.ts` fails the build if a
-- future account-scoped table is missing from this list.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM channel_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM account_subscriptions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM account_grants WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM invoices WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM outbound_emails WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;
ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
