# hc-cloudwa — Deploy notes (Vercel + hosted Supabase)

App: https://hc-cloudwa.vercel.app
Supabase project ref: `lrhqeaihiqxvltzkhqre`

## State verified 2026-09-28 (by probing the live deployment)
- Vercel deploy is up: `/` → 307 `/dashboard`, `/login` + `/signup` → 200.
- Public env is correct: anon key baked in the client bundle is `role: anon` for ref
  `lrhqeaihiqxvltzkhqre` (no service_role leak in the browser).
- Server routes answer: `/api/account` 401, `/api/v1/me` 401 (missing API key),
  `/api/webhooks/meta` 403 (verify token mismatch) — app code runs.
- BLOCKER: the database schema is NOT installed on the Supabase project —
  `GET /rest/v1/profiles` → `PGRST205 Could not find the table 'public.profiles'`.
  Same for `accounts`. Login/signup therefore cannot work.
- Auth: `mailer_autoconfirm: false` → signup requires clicking a confirmation email
  (Supabase's built-in SMTP is heavily rate-limited). Turn "Confirm email" off for demos.
- `/api/automations/cron` + `/api/flows/cron` → 503 `cron not configured`
  (AUTOMATION_CRON_SECRET unset) — expected, harmless for a demo.

## Steps to make login work
```bash
supabase login                                   # browser, on the machine
cd ~/rado-yard/exbolt
supabase link --project-ref lrhqeaihiqxvltzkhqre # asks for the DB password once
supabase db push                                 # applies the 39 migrations
```
Fallback without the CLI: paste `deploy/hc-cloudwa-migrations.sql` into the
Supabase SQL editor (project → SQL Editor → New query).

Then: Supabase → Authentication → Sign In / Providers → Email → **Confirm email = off**.
Then: open `/signup` (full name + email + password ≥ 6 chars). The `on_auth_user_created`
trigger creates the `accounts` row + owner profile. Afterwards log in at `/login`.

Users created BEFORE the schema existed are healed automatically — migration 017
contains a backfill that inserts the missing profile and account rows.

## Vercel env vars (Production) to verify
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — set (verified in bundle).
- `SUPABASE_SERVICE_ROLE_KEY` — server routes need it.
- `ENCRYPTION_KEY` — 64 hex chars (AES-256-GCM for saved WhatsApp tokens).
- `META_APP_SECRET` — webhook HMAC (placeholder is fine until a real WABA is connected).
- `NEXT_PUBLIC_SITE_URL=https://hc-cloudwa.vercel.app` — invite links / email redirects.
- `WHATSAPP_TEMPLATES_DRY_RUN=true` — lets the template UI work with no real WABA (demo).
- Do NOT set `SUPABASE_PROXY` (local-dev only).
Redeploy after changing any env var.
