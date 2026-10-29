-- ============================================================
-- 078 — conversations are per (account, contact, NUMBER)
--
-- Why: the 24-hour customer-service window is tracked by Meta PER
-- BUSINESS NUMBER. With one thread per contact, a customer who wrote
-- to number B landed in the thread created on number A; the reply left
-- from A, where the window was already closed, and Meta answered
-- "more than 24 hours have passed since the customer last replied to
-- this number" — a failure that looks like a routing bug in the CRM.
--
-- So a contact may now hold one conversation per WhatsApp number.
-- Replies still leave from the thread's own number, which is the
-- number the customer wrote to.
--
-- Rows with a NULL whatsapp_config_id are pre-075 leftovers; the 075
-- backfill filled them, and every insert since sets the column, so the
-- partial index covers all real traffic without rejecting legacy rows.
-- ============================================================

drop index if exists idx_conversations_account_contact;

create unique index if not exists idx_conversations_account_contact_number
  on conversations (account_id, contact_id, whatsapp_config_id)
  where whatsapp_config_id is not null;

-- Lookup shape used by the inbound webhook and the API resolver.
create index if not exists idx_conversations_contact_number
  on conversations (account_id, contact_id, whatsapp_config_id);
