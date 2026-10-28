-- 073_landing_content.sql
-- Make the landing page's commercial details editable from the admin panel.
--
--   plans.*            → price, limits, feature pick, description, featured badge
--   landing_settings   → sales contact + response promise shown on the page
--
-- The public read model is /api/public/landing (service role, no auth).

alter table public.plans
  add column if not exists landing_desc_ar text,
  add column if not exists landing_desc_en text,
  add column if not exists landing_features jsonb not null default '[]'::jsonb,
  add column if not exists is_featured boolean not null default false;

update public.plans set
  landing_desc_ar = 'للفريق الصغير اللي عايز يلمّ كل المحادثات في مكان واحد.',
  landing_desc_en = 'For a small team that wants every conversation in one place.',
  landing_features = '["inbox","contacts","pipelines","broadcasts","automations","reports","ai_suggest"]'::jsonb,
  is_featured = false
where code = 'core';

update public.plans set
  landing_desc_ar = 'لفريق مبيعات ودعم شغال على أكتر من قناة.',
  landing_desc_en = 'For a sales and support team working across more than one channel.',
  landing_features = '["inbox","multi_channel","ai_agent","ai_knowledge","flows","reports_advanced","team_roles","audit_log"]'::jsonb,
  is_featured = true
where code = 'growth';

update public.plans set
  landing_desc_ar = 'لمجموعة فروع أو فريق كبير محتاج تحكم كامل.',
  landing_desc_en = 'For a branch network or a large team that needs full control.',
  landing_features = '["inbox","multi_channel","branches","api","webhooks","integrations","reports_advanced","support_priority","training"]'::jsonb,
  is_featured = false
where code = 'scale';

create table if not exists public.landing_settings (
  id smallint primary key default 1 check (id = 1),
  sales_email text not null default 'sales@excal.uk',
  sales_phone text,
  whatsapp_number text,
  response_time_ar text not null default 'خلال يوم عمل',
  response_time_en text not null default 'Within one business day',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.landing_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.landing_settings enable row level security;
-- Service-role only, like platform_settings: no anon policies.

comment on table public.landing_settings is
  'Sales contact details rendered on the public ExBolt landing page.';
