-- ============================================================
-- 075 — Multiple WhatsApp numbers per account (additive half)
--
-- Phase 0 of docs/multi-whatsapp-numbers.md. Everything here is
-- additive and nullable, so code that still assumes ONE row per
-- account keeps working unchanged.
--
-- The destructive half lives in 076_drop_whatsapp_config_account_unique.sql
-- and is applied ONLY after the multi-aware code is live (every read
-- goes through src/lib/whatsapp/config-resolver.ts).
--
-- Idempotent on purpose: this box has no migration ledger, so the
-- file is applied by hand and may be re-run.
-- ============================================================

-- One row per NUMBER, not per account. `is_default` marks the number a
-- send without an explicit choice uses.
alter table whatsapp_config
  add column if not exists is_default boolean not null default false;

-- A number appears once per account.
create unique index if not exists whatsapp_config_account_number_key
  on whatsapp_config (account_id, phone_number_id);

-- Exactly one default per account.
create unique index if not exists whatsapp_config_one_default_per_account
  on whatsapp_config (account_id) where is_default;

-- Conversations remember which number they belong to, so a reply leaves
-- from the number the customer wrote to.
alter table conversations
  add column if not exists whatsapp_config_id uuid
  references whatsapp_config(id) on delete set null;

create index if not exists idx_conversations_whatsapp_config
  on conversations (whatsapp_config_id);

-- ---- backfill -------------------------------------------------
-- Existing accounts: their single number becomes the default.
update whatsapp_config w
   set is_default = true
 where w.id = (
         select w2.id
           from whatsapp_config w2
          where w2.account_id = w.account_id
          order by w2.created_at asc, w2.id asc
          limit 1
       )
   and not exists (
         select 1 from whatsapp_config d
          where d.account_id = w.account_id and d.is_default
       );

-- Existing conversations: attach the account's default number.
update conversations c
   set whatsapp_config_id = w.id
  from whatsapp_config w
 where w.account_id = c.account_id
   and w.is_default
   and c.whatsapp_config_id is null;
