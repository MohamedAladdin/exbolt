# Activity log (per-account audit trail)

Every change to an account's **settings, integrations, content, automations,
team roles and inbox assignments** is recorded with who did it and when, and
shown in **Settings → Activity log** (admin+ on GROWTH and SCALE).

It answers the question a shared team eventually asks: *"who changed this?"*
Four admins on one number is exactly the shape that needs an answer.

## Where the recording happens

In Postgres, not in the API routes — `supabase/migrations/070_account_activity_log.sql`
installs `account_activity_log` plus one trigger per audited table:

| Area | Tables |
| --- | --- |
| Account | `accounts` |
| Settings | `whatsapp_config`, `ai_configs`, `custom_fields`, `tags`, `pipelines` |
| Integrations | `channel_configs`, `api_keys`, `webhook_endpoints` |
| Content | `message_templates`, `quick_replies`, `ai_knowledge_documents` |
| Automations | `automations`, `flows` |
| Team | `profiles` (join / role change / removal), `account_invitations` |
| Inbox | `conversations` — assignment changes only |

Why triggers and not a `logActivity()` call per route: a write path added
later is covered without anyone remembering to instrument it, client-side
Supabase writes are covered too, and the actor is `auth.uid()` **at write
time** — nothing the browser sends can name someone else. Writes with no
session (cron, webhook, flow engine, service role) are filed as `system`.

Each row stores a field-by-field diff (`changes`) computed in the trigger, so
the UI never needs the before-state. **Secrets never land in the log**: any
column matching `secret|token|password|api_key|key_hash|credential` is written
as `•••`, and long text is clipped to 280 characters. Deleting an account
cascades its trail away with it.

## Reading it

The trail holds two different records, and the UI reads them through a
**scope** so the louder one cannot bury the other:

* `admin` — settings, integrations, content, automations and team changes.
  This is the operator log.
* `inbox` — conversation assignments and status changes (with the
  `from → to` state). This is the inbox stream.

* UI: `Settings → Activity log` — a scope switcher over a day-grouped
  timeline; the admin scope carries the category chips, actor filter,
  debounced search, inline before → after diffs and keyset pagination.
  `?scope=inbox` deep-links straight to the inbox record.
* API: `GET /api/account/activity?scope=admin|inbox&limit=&before=&category=&actor=&q=`
  (admin+, 120 requests/min/user). `scope` is applied in SQL
  (`category <> 'inbox'` / `category = 'inbox'`); an unknown value reads the
  whole trail.
* Dashboard: **Admin activity** shows the newest six admin events and
  **Inbox activity** sits beside it with the newest six inbox events, so an
  admin who never opens settings sees both a colleague rotating a token and
  the day's assignment/status traffic without one hiding the other.

## Plan gate

`audit_log` is a plan feature (migration 071): **CORE off, GROWTH and SCALE
on**. Enforcement is server-side in the API route (`requireFeature('audit_log',
'admin')` → `402`); the tab an admin cannot use is also hidden from the
settings rail and replaced with an upgrade note on a deep link. Recording
continues on every plan — upgrading reveals the history that already exists.

## Retention — 180 days

`purge_account_activity(p_retention_days DEFAULT 180, p_batch_size DEFAULT 20000)`
deletes anything older than the window, in batches, and returns the row count.
`idx_account_activity_created_at` exists to serve that sweep (the read indexes
are keyed by account, the sweep is keyed by time).

It is called daily by an external pinger, like the other crons:

```cron
# /etc/cron.d/exbolt-cron — 03:17 daily
17 3 * * * deploy curl -fsS -o /dev/null -H "x-cron-secret: $SECRET" \
  http://127.0.0.1:3000/api/admin/cron/activity-retention
```

Auth is the same shared secret as the automation/flow crons
(`ADMIN_CRON_SECRET`, falling back to `AUTOMATION_CRON_SECRET`); with no
secret configured the route answers `503` so an unscheduled box is loud
rather than silently unlimited.

Manual run (returns `{ "deleted": N, "retentionDays": 180 }`):

```bash
curl -H "x-cron-secret: $SECRET" https://bolt.excal.uk/api/admin/cron/activity-retention
```

## Verifying on a local database

`references/activity-log-trigger-tests.sql` in the `wacrm-ops` skill is a
54-check matrix (every table, masking, no-op suppression, actor attribution,
RLS, and account deletion with cascaded children). It runs inside one
transaction and rolls back.
