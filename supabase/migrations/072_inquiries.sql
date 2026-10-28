-- 072_inquiries.sql
-- Public landing-page enquiries, read and triaged from the super-admin panel.
--
-- The landing page posts to /api/public/inquiries through the service role;
-- no anon policy exists on purpose. Platform admins read/update the rows via
-- /admin/inquiries, which is gated by requirePlatformAdmin().

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text not null,
  phone text,
  team_size text,
  plan text,
  message text,
  locale text not null default 'ar',
  source text not null default 'landing',
  page text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'won', 'lost', 'archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inquiries_created
  on public.inquiries (created_at desc);

create index if not exists idx_inquiries_status
  on public.inquiries (status, created_at desc);

alter table public.inquiries enable row level security;
-- Deliberately no policies: anon/authenticated keys cannot read or write.
-- The service role bypasses RLS; both write paths are server-side routes.

comment on table public.inquiries is
  'Landing-page sales enquiries. Service-role only; triaged in /admin/inquiries.';
