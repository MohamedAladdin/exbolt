-- 067_multi_whatsapp_numbers.sql — phase 0 of docs/multi-whatsapp-numbers.md
--
-- Additive only. Nothing that exists today is renamed, dropped or rewritten:
-- the `whatsapp_config_account_id_key` UNIQUE(account_id) constraint stays in
-- place until phase 4, so this migration is safe to apply to a live database
-- whose application code still assumes one number per account.
--
-- What it adds:
--   * `whatsapp_config.is_default` — exactly one flagged row per account, so
--     every "read the account's number" call site can become deterministic
--     (`.order('is_default', { ascending: false }).limit(1)`) before the
--     one-row-per-account constraint is ever removed.
--   * `whatsapp_config (account_id, phone_number_id)` UNIQUE — the key the
--     multi-number upsert will use in phase 4.
--   * `conversations.whatsapp_config_id` — which number a thread belongs to,
--     so a reply can go out from the same number it came in on.

-- 1. Default flag -----------------------------------------------------------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing rows are the only number their account has, so they are the default.
UPDATE whatsapp_config w
   SET is_default = TRUE
 WHERE w.is_default = FALSE
   AND NOT EXISTS (
     SELECT 1 FROM whatsapp_config d
      WHERE d.account_id = w.account_id AND d.is_default
   );

-- One default per account.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_one_default_per_account
  ON whatsapp_config (account_id)
  WHERE is_default;

-- 2. The key the multi-number upsert will use ------------------------------
-- phone_number_id is already NOT NULL and globally unique on this table in
-- practice; scoping the index to the account makes the intent explicit and
-- matches the onConflict target the API will use.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_account_number_key
  ON whatsapp_config (account_id, phone_number_id);

-- 3. Which number a conversation belongs to --------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
  REFERENCES whatsapp_config(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);

-- Backfill: today every account has one number, so every existing WhatsApp
-- thread belongs to it. Non-WhatsApp threads (messenger / instagram) keep NULL.
UPDATE conversations c
   SET whatsapp_config_id = w.id
  FROM whatsapp_config w
 WHERE c.whatsapp_config_id IS NULL
   AND c.account_id = w.account_id
   AND (c.channel IS NULL OR c.channel = 'whatsapp');

-- RLS: conversations is already account-scoped; whatsapp_config keeps its
-- existing policies. No new policy is introduced here — phase 4 revisits
-- insert/update so a second number cannot be created by a non-admin.
