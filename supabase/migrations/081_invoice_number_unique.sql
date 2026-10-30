-- ============================================================
-- 081 — invoice numbers are unique, enforced by the database
--
-- `create_invoice` always assumed a UNIQUE index on `invoices.number`
-- (it retries on 23505 when a concurrent create takes the same number),
-- but the table never carried one — only the primary key and the
-- account/due-date indexes. With random codes the collision chance is
-- tiny, and "tiny" is exactly the kind of uniqueness a customer will
-- eventually disprove. Add the index so the retry path is real.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number_unique
  ON public.invoices (number);
