-- ============================================================
-- 079 — payment reference on an invoice
--
-- A subscription is often paid by transfer (Binance / InstaPay / bank),
-- and the operator needs the provider's own order id and the payer's
-- name on the invoice the tenant downloads — the amount alone cannot be
-- reconciled against a statement. Additive and nullable: the old code
-- ignores both columns, so this migration can land before the deploy.
-- ============================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_payer TEXT;

COMMENT ON COLUMN public.invoices.payment_reference IS
  'Provider-side transaction/order id (Binance order number, bank ref, …).';
COMMENT ON COLUMN public.invoices.payment_payer IS
  'Name the payment came from, when it differs from the account name.';
