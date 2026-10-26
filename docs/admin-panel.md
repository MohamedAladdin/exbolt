# Super-Admin panel (`/admin`) — v1

Internal ops console for the platform owner. Separate surface from the tenant
app: different shell, Arabic-first copy, and every read/write goes through the
service role **after** the caller is verified against `platform_admins`.

Blocked in this release: **no push**. Everything below is committed-work-in-tree
only until Mohamed tries it.

---

## 1. What it does

| Area | Screen | Capabilities |
|---|---|---|
| Overview | `/admin` | MRR, active tenants, trials ending in 7d, overdue invoices, signups 7d/30d, what needs attention, registration open/close toggle |
| Accounts | `/admin/accounts` | Search + filter by status/plan; usage per tenant (seats, contacts, conversations, 30d messages, channels, last activity) |
| Tenant detail | `/admin/accounts/[id]` | Status (active / suspended / archived / blocked) with reason · plan + subscription status + period/trial end · internal notes · grants · members + per-user block · invoices · channel list · email composer · audit trail · email log |
| Billing | `/admin/billing` | Invoices across all tenants (send / mark paid / void) · run payment reminders now · plan catalogue editor (price, features, limits) |
| Channels | `/admin/channels` | WhatsApp / Messenger / Instagram per tenant with token expiry + last Graph error; enable, disable, revoke |
| Audit | `/admin/audit` | Append-only log: who did what, to whom, when, with the payload diff |
| Settings | `/admin/settings` | Registration (open / invite-only / closed + message), maintenance notice, mail identity, reminder policy, platform admins, signup allowlist |

---

## 2. Security model

- `platform_admins` has RLS enabled and **no policies** → anon/authenticated
  clients cannot read it; only the service role can.
- Every page calls `guardAdminPage()` (signed out → `/login`, not an admin →
  `/dashboard`), and every API route calls `requirePlatformAdmin()`.
- The admin API is a command surface: one `PATCH /api/admin/accounts/[id]` with
  an `action` field, one `POST /api/admin/invoices`, etc. Unknown actions fail
  loudly.
- Nothing in the panel is reachable from the tenant UI, and the tenant UI gains
  no new admin powers.

### Tenant lifecycle enforcement

`accounts.status` is checked in `getCurrentAccount()` — the single choke point
every API route and server component uses. `suspended` / `archived` / `banned`
return **403** for every operation. The app shell also renders a block screen
(Arabic/English) instead of an empty dashboard, reading the same column in the
one query it already made.

> Known limit: tenant *reads* through the browser's RLS client still resolve
> while suspended (RLS is unchanged), so the block screen is what the customer
> sees and every write/send is refused. If a hard read-block is wanted later,
> `is_account_member()` is the one function to extend.

### Registration gate

Three layers, because the anon key is public:

1. `GET /api/auth/signup-status` → the form shows "registration is closed"
   instead of a form that cannot submit.
2. `enforce_signup_gate` trigger on `auth.users` (BEFORE INSERT) raises
   `SIGNUP_CLOSED` — a raw `POST /auth/v1/signup` with the anon key is refused
   too (verified: HTTP 500 / `23514 SIGNUP_CLOSED`).
3. `signup_allowlist` is the only door while closed/invite-only; each row opens
   exactly one account (`used_at`).

> Team invitations do **not** carry an email (only a free-text `label`), so an
> invited teammate must be added to the allowlist from the panel while
> registration is closed.

---

## 3. Grants & gifts

`account_grants` (kind, key, value, expires_at, revoked_at) is layered on top of
plan + `feature_overrides` inside `getAccountEntitlements()`, so a gift takes
effect on the next request with no deploy and no plan invented for that client.
Resolution order: plan → per-account overrides → **active grants** (grant wins,
because it is explicit and time-boxed). A tenant may read its own grants (RLS
policy `account_grants_select`); only the panel can write them.

Kinds: `feature` (on/off), `limit` (number), `plan_upgrade`,
`trial_extension` ({months}), `discount` ({percent}), `credit` ({amount}).

`plan_upgrade` / `trial_extension` / `discount` / `credit` are recorded and
visible, but only `feature` and `limit` are consumed by the entitlements
resolver today — trial extension is applied by setting `trial_ends_at` in the
subscription controls (that is the same edit, one click).

---

## 3b. Why some tenants don't see `Flows`

Not a deletion: the route ships and the sidebar hides nav rows whose plan
feature is off. An account with **no `account_subscriptions` row** resolves to
the CORE defaults, where `flows` is `false` — that is why the live box shows no
Flows for the owner account while a Growth tenant does. Give the tenant a plan
(or a `flows` feature grant) and the row appears without a deploy.

## 4. Billing & email

- **Invoices**: number `EXB-YYYY-NNNN`, per-year sequence derived from issued
  numbers (UNIQUE still enforced, one retry on collision). Amounts computed
  server-side from line items; `amount` excludes nothing — it is the total.
- **Email**: SMTP via nodemailer (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS`, optional `MAIL_FROM`). With no SMTP the message is rendered,
  stored in `outbound_emails` with status `dry_run`, and the UI says so — it
  never pretends to have sent. **SMTP is not configured on this machine or the
  prod box yet**, so every send today is a dry run.
- **Reminders**: policy = `reminder_days_before` (3), then on the due date, then
  every 3 days until `grace_days` (7), then one final notice; max 4 per invoice;
  paid/void/draft never reminded. Run from the Billing screen, or on a schedule:

  ```
  curl -H "x-admin-secret: $ADMIN_CRON_SECRET" https://<host>/api/admin/cron/reminders
  ```

  (falls back to `AUTOMATION_CRON_SECRET` when no dedicated secret is set).

---

## 5. Database (migration `065_platform_admin.sql`)

New: `platform_admins`, `platform_settings` (singleton), `signup_allowlist`,
`account_grants`, `invoices`, `outbound_emails`, `admin_audit_log`,
`is_platform_admin()`, `enforce_signup_gate` trigger, `admin_account_stats()`
RPC, plus `accounts.status*`, `profiles.blocked_*`, and
`whatsapp_config/channel_configs.token_expires_at` + `last_error`.

`redeem_invitation` is re-emitted with the three new account-scoped tables —
`src/lib/auth/redeem-invitation-migration.test.ts` fails the build otherwise.

Make yourself an admin:

```sql
insert into platform_admins (user_id, email)
select id, email from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;
```

---

## 6. Verification (all executed, not planned)

- `npx tsc --noEmit` → clean. `npx eslint` on the new tree → clean.
- `npx vitest run` → **1587 passed** (142 files), including 19 new pure-module
  tests (invoice arithmetic/numbering, reminder policy, money rounding).
- `deploy/verify-admin-panel.py` → **25/25**: login, every screen renders in
  Arabic, English locale renders, registration close/open from the UI, DB gate
  refuses a raw signup while closed and allows it when open, audit row written,
  signed-out `/admin` redirects to `/login`.
- `deploy/verify-admin-flows.py` → **14/14**: feature grant flips tenant
  entitlements `false → true` and back on revoke; invoice created with the next
  number and correct total; send reports `dry_run`; mark-paid works; suspend
  returns 403 from the tenant API and shows the block screen; restore works.
- Screenshots: `docs/admin-shots/`.

## 7. Local run

```bash
cd ~/rado-yard/exbolt
npx supabase start -x analytics      # if not running
npm run build
bash deploy/restart-local.sh         # rebuild + standalone on :3000
```

Login: `test@excal.local` / `Test12345!` (already a platform admin locally).

Hosts: `127.0.0.1`, `192.168.0.111` and `10.0.0.1` all work from ONE build because
`NEXT_PUBLIC_SUPABASE_FOLLOW_ORIGIN=true` makes the browser client use
`window.location.origin` and the server/middleware use the raw `Host` header.
That flag exists because `@supabase/ssr` derives its cookie name from the project
URL host (`sb-10-auth-token` vs `sb-192-auth-token`): a mismatch means login
"works" and then bounces back to `/login` with no error. Sessions are per-host,
so sign in once on each URL.

Access rules: a non-admin gets bounced from `/admin` to `/dashboard` and every
`/api/admin/*` write answers 403 (verified by `deploy/verify-admin-access.py`).
Signed-out visitors go to `/login?next=/admin` and land on the panel after
signing in. Platform admins also get a dashed "لوحة السوبر أدمن" row in the
tenant sidebar, driven by `GET /api/admin/session`.

## 8. Not done yet (deliberate)

- Impersonation ("log in as tenant") — powerful and easy to get wrong.
- PDF invoice attachment (email carries the full invoice table today).
- Payment gateway (Fawaterk/Paymob) reconciliation — invoices are manual.
- Per-tenant usage graphs — counts only.
- `plan_upgrade` grant semantics (recorded, not applied — see §3).
