# Multiple WhatsApp numbers per account — implementation

Status: **built (phases 0–4), not deployed.** A GROWTH customer can
hold more than one number; CORE (`channels: 1`) still refuses the second
one with a 402.

## Why it was blocked

`supabase/migrations/017_account_sharing.sql` put
`UNIQUE (account_id)` on `whatsapp_config`, and the Settings form was a
single upsert on that key — "connecting a second number" silently
**replaced** the first one.

## What ships

| Piece | Where |
|---|---|
| Additive schema (columns + indexes + backfill) | `supabase/migrations/075_multi_whatsapp_numbers.sql` |
| Constraint drop (**phase 4**, applied after the code) | `supabase/migrations/076_drop_whatsapp_config_account_unique.sql` |
| Number resolution (default / by id / per conversation) | `src/lib/whatsapp/config-resolver.ts` |
| Every writer/reader moved off `.single()` | send-message, broadcast-core, broadcast-resume, automations/meta-send, flows/meta-send, resolve-conversation, media, react, health, templates ×3, broadcast route, webhook, settings |
| Add / promote / remove a number | `POST` · `PATCH` · `DELETE ?id=` on `/api/whatsapp/config` |
| Settings UI (list + “إضافة رقم”) | `src/components/settings/whatsapp-numbers-card.tsx` |
| Plan gate | `requireWithinLimit('channels', numbers + active social channels)` before an insert |

## Behaviour

- **Inbound** already routed by `phone_number_id` (the webhook resolves
  the tenant from that column); it now also stamps the conversation with
  `whatsapp_config_id`.
- **Outbound** replies use the conversation's number; threads created
  before the backfill (or whose number was removed) fall back to the
  account default. Broadcasts, automations, flows and templates still
  use the default number — a per-number selector for those is phase 5.
- **One conversation per contact** is unchanged. A customer who writes to
  the second number lands in their existing thread; the thread keeps the
  number it was created with, and the agent can still answer (the message
  leaves from that number, not the one the customer just used). Splitting
  threads per number is a bigger change: the unique index from migration
  036 is `(account_id, contact_id)`.
- **Never delete a number to “disconnect” silently**: `DELETE ?id=`
  removes the row; conversations keep `whatsapp_config_id` via
  `ON DELETE SET NULL`, so history stays readable.
- **The Meta app does not change.** The second number is added manually
  with a permanent token from the same app / system user as the first
  (`META_APP_ID` in `.env.production`), so webhook signatures keep
  verifying with the existing `META_APP_SECRET`. No env edit, no
  restart of the app-level webhook.

## Deploy order (no migration ledger on the box)

1. Deploy the commit (`exbolt-deploy main`) — the resolver is safe with
   one row **and** with many, so nothing changes for the live tenant.
2. Apply `076_drop_whatsapp_config_account_unique.sql`:
   `docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < 076_…sql`
3. In Settings → WhatsApp, “إضافة رقم” and paste the second number's
   `phone_number_id`, WABA id, permanent token, and the 6-digit PIN.
4. Prove it: send one message to each number, confirm the inbound row
   lands on the right conversation and the Graph send used that
   `phone_number_id`; then set the default and check a fresh thread.

Rollback: delete the extra row, re-add
`alter table whatsapp_config add constraint whatsapp_config_account_id_key unique (account_id);`

## Still open (phase 5)

- Per-number selector for **new** conversations and broadcasts.
- Inbox filter chips (كل الأرقام / رقم ١ / رقم ٢) and the receiving
  number in the thread header.
- Dashboard volume grouped by number.
