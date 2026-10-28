# Tenant plan requests

The tenant plan page (`/settings?tab=plan`) now shows the subscription window
and lets an account admin ask for a renewal or a plan change.

## Data

`account_requests` (migration `074`):

| column | meaning |
| --- | --- |
| `kind` | `renewal` or `change_plan` |
| `current_plan_code` / `requested_plan_code` | plan codes at request time |
| `billing_interval` | `monthly` / `annual` |
| `message` | optional note from the customer |
| `status` | `new` → `in_review` → `done` / `declined` |
| `admin_notes` | internal notes from the platform team |

RLS: members can read their account's requests; only account admins can insert
(`user_id = auth.uid()`). Platform admins use the service role.

A request is **not** an entitlement change. The platform team applies the plan
from `/admin/landing` / the super-admin panel after reviewing the request.

## Tenant UI

- Start date (`started_at`), end date (`current_period_end`, or
  `trial_ends_at` on trial), billing cycle, price, limits and features.
- A window progress bar and days remaining.
- Warnings for trial ending, plan expiring within 14 days, expired, past due,
  and not entitled.
- `Renew plan` / `Change plan` open a dialog; both create one open request per
  account (a second submit returns `409 request_pending`).
- Agents see the page read-only; only owner/admin can submit.

## Admin UI

- `/admin/requests` lists account, requester, kind, current → requested plan,
  interval, status, customer message and internal notes.
- Status is editable inline; notes are saved separately.
- The sidebar `Customer requests` item shows a badge with open
  (`new` + `in_review`) requests.

## API

- `GET /api/account/plans` — active plans for the change dialog.
- `GET|POST /api/account/requests` — tenant list / create.
- `PATCH /api/admin/requests/[id]` — platform-admin status + notes.
