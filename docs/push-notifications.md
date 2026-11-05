# Push notifications and conversation ownership

Out-of-app alerts (Web Push over VAPID) and the rules that decide who owns an
unassigned conversation. Both are implemented as migrations + server code; this
page is the operator's view — what is guaranteed, what is deliberately not, and
what to check when a phone stays silent.

## What is guaranteed — and what is not

| Guarantee | Mechanism |
|---|---|
| **At most one outbox row per (conversation, recipient, 60 s)** | `push_outbox.dedupe_key` UNIQUE + `ON CONFLICT … DO UPDATE` |
| **At most one sender per row** | claim = `UPDATE … SET claimed_at = now() WHERE … AND claimed_at IS NULL`; a claim older than 2 minutes is treated as a dead sender |
| **At least one attempt** | the row is durable; the sweeper retries at 1 / 5 / 15 / 60 minutes, then gives up with `last_error` |
| **A push bug never rejects a customer message** | the trigger swallows its own exception; `reconcile_push_outbox()` backfills anything it lost and returns the count |
| **Nobody is alerted for a thread they no longer own** | ownership is re-read at send time; a mismatched row is marked `skipped` / `reassigned` |
| **The record is never switchable** | `notification_preferences` gates channels and types, never the `notifications` row |

**Not guaranteed: exactly-once display.** A dismissible banner that the user
already closed can reappear if a retry fires. What ships is:

> تقليل تكرار الإشعارات الظاهرة عبر استبدال الإشعار ذي الـ tag نفسه.

A thread-scoped push carries `tag = conv:<conversation_id>`, so a newer alert on
the same thread *replaces* the banner instead of stacking. The retry path is the
only way the same banner can be shown twice.

**Failure statement for the docs:** the alert pipeline never blocks a customer
message; an enqueue failure is repaired within one minute by the reconciler and
reported as `reconciled` in the sweep response. A non-zero `reconciled` is a
**bug signal**, not routine repair.

## Who gets alerted

1. **Assigned thread** → its assignee only.
2. **Unassigned thread** → `accounts.unassigned_alert_roles` ∩
   `accounts.unassigned_alert_members` (NULL = everyone holding those roles).
   Defaults: `owner`, `admin`, `agent`. Viewers are never alerted.
3. **A recipient with no registered device gets no row at all.** Enabling
   notifications starts from that moment; it does not replay a backlog. (A busy
   account with 13 members and no devices generated ~130 wasted rows/minute
   before this rule.)
4. **Ownership changed while a row waited** → skipped at send, never delivered
   to the previous owner.

Two producers can touch one thread inside one webhook (a customer message and an
AI handoff). They share one 60-second bucket, and **severity wins**:
`ai_handoff` > `conversation_assigned` > `customer_message` — one banner, one
sound, and it is the most actionable one.

## Conversation ownership

`claim_conversation(conversation_id, reason)` is the single writer:

* `auto_claim_on_reply` (default **on**) — whoever replies on an unassigned
  thread becomes its owner.
* `auto_claim_on_open` (default **off**) — opening it claims it. Reading is not
  a commitment.
* `first_opened_by` / `first_opened_at` are recorded **always**, regardless of
  both switches. They answer "who saw this first" without changing ownership.
* A thread assigned to a colleague is **never stolen**; a caller outside the
  account, or without a role in `auto_claim_roles`, is a no-op.

Configured in **Settings → صندوق الوارد → ملكية المحادثة**.

## Privacy and quiet hours

* `push_preview`: `none` (no name, no text) · `name` (default) · `full`.
* Quiet hours suppress **push only**; the in-app popup keeps working. Both ends
  are required, and a window may wrap midnight.
* Payloads are fitted under the 4 KB protocol limit before sending; the body is
  shortened, never the title.

## Deployment

```bash
# 1. schema (idempotent — safe to re-run)
psql "$DATABASE_URL" -f supabase/migrations/105_push_subscriptions.sql
psql "$DATABASE_URL" -f supabase/migrations/106_notification_preferences.sql
psql "$DATABASE_URL" -f supabase/migrations/107_push_outbox.sql
psql "$DATABASE_URL" -f supabase/migrations/108_conversation_ownership.sql

# 2. keys — generate once per deployment, then rebuild (they are read at runtime,
#    but the container must be recreated to see them)
npx web-push generate-vapid-keys --json
# VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com

# 3. the sweeper, every minute, with the same secret the other crons use
* * * * * deploy curl -fsS -o /dev/null -X POST \
  -H "x-cron-secret: $AUTOMATION_CRON_SECRET" http://127.0.0.1:3000/api/push/sweep
```

If `VAPID_*` is missing, `isPushConfigured()` is false and every send is a
no-op — the app keeps working, the settings panel says «الإشعارات غير مُهيّأة».
Rotating the keys invalidates every existing subscription: each device must
re-enable notifications.

## Troubleshooting

| Symptom | Check |
|---|---|
| Sweep answers `{"ok":false,"error":"push_not_configured"}` | `VAPID_*` in the container env; recreate, do not just restart |
| Rows pile up as `pending` | the cron line exists (`/etc/cron.d/exbolt-cron`) and the secret matches |
| Everything is `skipped: no_device` | the user has no `push_subscriptions` row — enable on the device |
| `reconciled` is not 0 on a quiet system | the trigger is raising; read `docker logs exbolt-app` and `push_outbox.last_error` |
| A device keeps failing | Settings → الإشعارات → الأجهزة flags it; remove and re-enable |
