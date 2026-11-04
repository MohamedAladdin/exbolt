-- 098 — the inbox opens on the filter the account chooses
--
-- The default was hardcoded to «مفتوحة» (src/lib/inbox/inbox-filters.ts). A
-- clinic that lives in «محتاجة متابعة» and a sales desk that lives in
-- «بانتظار رد» both had to click twice every morning, so the choice moves to
-- Settings → Inbox, per account.
--
-- The value is the same vocabulary `inbox_page` already accepts, enforced here
-- so a typo can never leave an account with an inbox that refuses to open.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS default_inbox_filter TEXT NOT NULL DEFAULT 'open';

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_default_inbox_filter_valid;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_default_inbox_filter_valid
  CHECK (default_inbox_filter IN (
    'all', 'unread', 'waiting', 'unassigned', 'expiring', 'open', 'pending', 'closed', 'followup'
  ));

COMMENT ON COLUMN public.accounts.default_inbox_filter IS
  'Filter the Inbox opens on when no ?filter= is present; mirrors inbox_page p_filter';
