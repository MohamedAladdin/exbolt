-- ============================================================
-- 062_account_branding
--
-- The product ships white-labelled: each account shows its own system
-- name in the sidebar and the browser title, with the EXCAL credit as a
-- fixed suffix ("<name> من ExCal.uk" in Arabic, "<name> by ExCal.uk" in
-- English). `brand_name` is that per-account label.
--
-- NULL = fall back to the built-in product name, so every existing
-- account keeps rendering exactly what it renders today.
--
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS brand_name TEXT;

-- Guard against a wall of whitespace or a novel pasted by accident.
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_brand_name_length;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_brand_name_length
  CHECK (brand_name IS NULL OR char_length(brand_name) BETWEEN 1 AND 60);
