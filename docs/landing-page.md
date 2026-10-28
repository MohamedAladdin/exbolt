# ExBolt landing page

The marketing site is served by the Next app itself, so the landing page, the
tenant panel and the admin panel share one origin and one TLS certificate.

| URL | What it serves |
|---|---|
| `/` | Arabic landing (RTL) |
| `/ar` | Same Arabic landing |
| `/en` | English landing |
| `/login` | Tenant sign-in (then `/dashboard`) |
| `/admin` | Platform admin console (sign-in required) |

## Source and build

- Editable source: `~/rado-yard/exbolt-landing/` (`build.py`, `assets/`).
- Build writes the static pages and syncs assets into the app:

```bash
cd ~/rado-yard/exbolt-landing
python3 build.py        # → exbolt/public/landing/{ar,en}.html + assets/
```

- Served files: `public/landing/ar.html`, `public/landing/en.html`,
  `public/landing/assets/*`.
- Routing lives in `next.config.ts` (`beforeFiles` rewrites) and
  `src/middleware.ts` skips auth work for the public landing paths.
- `BASE` in `build.py` is the canonical origin. It currently points at
  `https://bolt.excal.uk` (the live host). Change it if the canonical host
  changes.

## Editable content (admin)

| Screen | What it controls |
|---|---|
| `/admin/landing` | Sales email, phone, WhatsApp, response-time promise; per-plan price, annual price, limits, Arabic name, AR/EN description, featured badge, and the feature bullets shown |
| `/admin/billing` | Plan entitlements and subscriber billing (the same `plans` rows) |
| `/admin/inquiries` | Landing form submissions: search, filter, status, internal notes |

The landing page ships static pricing for first paint/SEO, then refreshes
contact details and plan cards from `GET /api/public/landing?locale=ar|en`.
If the API is unreachable the static content stays in place.

## API

- `GET /api/public/landing?locale=ar|en` — public read model (plans, contact).
- `POST /api/public/inquiries` — lead capture (origin allow-list, 10/hour per
  IP, honeypot, validation, service-role insert).
- `PATCH /api/admin/landing` — admin-only content update.
- `PATCH /api/admin/inquiries/[id]` — admin-only status/notes update.

## Database

- `supabase/migrations/072_inquiries.sql` — `inquiries` table (RLS, no public
  policies).
- `supabase/migrations/073_landing_content.sql` — plan landing columns +
  `landing_settings` singleton.

Apply both before deploying code that reads them.

## Deploy notes

1. Apply migrations `072` and `073` on the target database.
2. `exbolt-deploy main` (or the branch carrying this work).
3. Verify from outside:
   - `/` → `200` landing (not a redirect to `/dashboard`)
   - `/en` → `200`
   - `/login` → `200`
   - `/admin` signed out → `307` to `/login?next=%2Fadmin`
   - `/admin` signed in → `200`
   - `/landing/assets/style.css` → `200 text/css`
4. `bolt.excal.com` does not currently resolve; the live host is
   `bolt.excal.uk`. If `.com` is the intended canonical host, point DNS at the
   app box first, then update `BASE` in `build.py` and rebuild.
