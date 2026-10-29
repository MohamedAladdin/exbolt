-- ============================================================
-- 077 — display identity for each WhatsApp number
--
-- Settings listed the Meta `phone_number_id`, which is meaningless to
-- a human. Store the number the customer actually knows
-- (`display_phone_number`, e.g. 201068910995) and the verified
-- business name, both read from Graph once per number.
--
-- Additive and nullable; existing rows fill in lazily on the next
-- Settings load (GET /api/whatsapp/config) or on save.
-- ============================================================

alter table whatsapp_config
  add column if not exists display_phone_number text;

alter table whatsapp_config
  add column if not exists verified_name text;
