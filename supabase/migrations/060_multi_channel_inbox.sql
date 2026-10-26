-- ============================================================
-- 060_multi_channel_inbox
--
-- Messenger (Facebook Page DMs) and Instagram DMs become
-- first-class inbox channels next to WhatsApp.
--
-- Model: a *channel* is a transport, not a tenant. Everything that
-- was implicitly "WhatsApp" now carries an explicit `channel`:
--
--   contacts.channel       — how this person reached us (default
--                            'whatsapp', so every pre-existing row
--                            is correct without a backfill).
--   contacts.channel_user_id — the channel-native id we address them
--                            by: PSID (Messenger) / IGSID
--                            (Instagram). WhatsApp keeps using
--                            `phone` + `wa_user_id`, untouched.
--   conversations.channel  — mirrors the contact's channel and is
--                            what the send path dispatches on.
--   channel_configs        — per-account credentials for the
--                            non-WhatsApp channels (one row per
--                            account+channel, same shape as
--                            whatsapp_config: encrypted token,
--                            settings-class RLS).
--
-- The (account_id, channel, channel_user_id) unique index is the
-- idempotency key the inbound webhook resolves contacts by, so a
-- Meta retry can never fork a second thread for the same person.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ---- contacts -------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_channel_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_channel_check
  CHECK (channel IN ('whatsapp', 'messenger', 'instagram'));

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS channel_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_account_channel_user_key
  ON contacts (account_id, channel, channel_user_id)
  WHERE channel_user_id IS NOT NULL;

-- ---- conversations -------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('whatsapp', 'messenger', 'instagram'));

CREATE INDEX IF NOT EXISTS idx_conversations_account_channel
  ON conversations (account_id, channel);

-- ---- channel_configs -----------------------------------------
CREATE TABLE IF NOT EXISTS channel_configs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('messenger', 'instagram')),
  -- Messenger: the Facebook Page id. Instagram: the IG business account id.
  external_id  TEXT NOT NULL,
  display_name TEXT,
  -- AES-256-GCM via src/lib/whatsapp/encryption.ts — same helper (and
  -- same ENCRYPTION_KEY) as whatsapp_config.access_token.
  access_token TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_configs_account_channel_key UNIQUE (account_id, channel),
  CONSTRAINT channel_configs_channel_external_key UNIQUE (channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_configs_account
  ON channel_configs (account_id);

DROP TRIGGER IF EXISTS set_updated_at ON channel_configs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON channel_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE channel_configs ENABLE ROW LEVEL SECURITY;

-- Same policy shape as whatsapp_config (migration 017): every member
-- may read (the inbox needs the display name), only admins write.
DROP POLICY IF EXISTS channel_configs_select ON channel_configs;
CREATE POLICY channel_configs_select ON channel_configs
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS channel_configs_insert ON channel_configs;
CREATE POLICY channel_configs_insert ON channel_configs
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS channel_configs_update ON channel_configs;
CREATE POLICY channel_configs_update ON channel_configs
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS channel_configs_delete ON channel_configs;
CREATE POLICY channel_configs_delete ON channel_configs
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Backfill: conversations always mirror the channel of their contact.
-- Only touches rows that predate this column (all now 'whatsapp' by
-- default) — a no-op on fresh installs.
UPDATE conversations c
SET channel = ct.channel
FROM contacts ct
WHERE ct.id = c.contact_id
  AND c.channel IS DISTINCT FROM ct.channel;
