-- ============================================================
-- 076 — one WhatsApp number per account: constraint removed
--
-- PHASE 4. Do NOT run this before the multi-aware code is live:
-- with two rows present, every `.single()` read of whatsapp_config
-- throws PGRST116 and sending/broadcasts break.
--
-- Order on a box without a migration ledger:
--   1. deploy the commit that ships config-resolver.ts (code is safe
--      with either one row or many)
--   2. apply this file
--   3. add the second number from Settings → WhatsApp
--
-- Rollback: delete every extra row, then re-add
--   alter table whatsapp_config add constraint whatsapp_config_account_id_key unique (account_id);
-- ============================================================

alter table whatsapp_config
  drop constraint if exists whatsapp_config_account_id_key;
