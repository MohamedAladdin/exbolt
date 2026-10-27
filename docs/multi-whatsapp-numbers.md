# Multiple WhatsApp numbers per account — plan (do not ship in one step)

Status: **proposed, not started.** Today an account can hold exactly **one**
WhatsApp number, so a GROWTH customer cannot use the second number the plan
sells.

## 0. Plan gating — wired first, not last

Every channel is a billable slot, so a second number must be refused by the
server when the plan is full. The mechanism exists but is **not wired today**:
`assertWithinLimit()` in `src/lib/plans/guard.ts` has **zero call sites** (checked
on `feat/meta-connect`), and only feature flags (`requireFeature`) are enforced.

Rules for this work:

- `limits.channels` counts **every active channel**: each WhatsApp number +
  Messenger + Instagram. GROWTH (`channels: 4`) therefore allows a second
  WhatsApp number only if the account has 3 or fewer channels in use;
  CORE (`channels: 1`) never allows one; SCALE (`channels: null`) is unlimited.
- The **add-number endpoint** calls
  `assertWithinLimit(entitlements, 'channels', currentActiveChannels + 1)`
  before touching `whatsapp_config`. A 402 `PlanError` is the only refusal
  path — never a silent no-op.
- Counting queries `channel_configs` (active) + `whatsapp_config` (active) in one
  place, so the number cannot drift between the UI and the server.
- The UI **disables** “إضافة رقم” and shows the upgrade hint when the count is
  at the limit, but that is cosmetic: the server check is the source of truth.
- Disconnecting a number frees its slot immediately (the row goes
  `is_active = false`), and the count follows.
- Existing single-number accounts are unaffected: they already fit CORE.

## 1. Why it is blocked today

`supabase/migrations/017_account_sharing.sql`:

```sql
ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_account_id_key UNIQUE (account_id);
```

One row per account. The Settings form is an upsert on that key, so “connecting
a second number” **replaces** the first one.

What already works in our favour — verify before designing anything new:

- `POST /api/webhooks/meta` resolves the tenant by
  `whatsapp_config.phone_number_id` (`route.ts` ~line 389) and already logs
  `Multiple configs found for phone_number_id` when it sees more than one row.
  **Inbound routing is multi-number ready.**
- Outbound, broadcasts, templates, automations and the AI reply all read the
  account’s single row and pass `phone_number_id` from it. This is the work.

Blast radius measured on `feat/meta-connect`: **27 files**, **38**
`from('whatsapp_config')` call sites, of which the dangerous ones are
`.maybeSingle()` / `.single()` reads that assume exactly one row.

## 2. Target data model

```sql
-- whatsapp_config keeps its role: one row per NUMBER, not per account.
alter table whatsapp_config add column if not exists is_default boolean not null default false;
create unique index if not exists whatsapp_config_account_number_key
  on whatsapp_config (account_id, phone_number_id);
-- one default per account
create unique index if not exists whatsapp_config_one_default_per_account
  on whatsapp_config (account_id) where is_default;

-- conversations remember the number they belong to
alter table conversations add column if not exists whatsapp_config_id uuid
  references whatsapp_config(id) on delete set null;
```

`whatsapp_config_account_id_key` is **dropped last**, not first.

## 3. Rollout — six phases, each independently deployable

| # | Change | Safety gate | Rollback |
|---|---|---|---|
| 0 | Add columns + indexes above (additive, nullable) | existing code keeps working unchanged | drop the new columns/indexes |
| 1 | Introduce `getWhatsAppConfigs(accountId)` / `getDefaultWhatsAppConfig(accountId)` and move **all 38 reads** to them. Behaviour identical: one row → default. | full test suite + send/broadcast/inbound regression on the live tenant | revert the commit |
| 2 | Backfill `conversations.whatsapp_config_id` = the account’s row; new conversations set it on create | count rows with null afterwards must be 0 | nullable column, safe |
| 3 | Send path picks `conversation.whatsapp_config_id ?? default` | send from an existing thread still uses the same number (assert `phone_number_id` in the Graph call) | keep the flag off |
| 4 | Drop `UNIQUE (account_id)`; enable the **Add number** UI behind `MULTI_WHATSAPP_ENABLED` | two numbers can coexist; inbound routes by `phone_number_id`; no cross-talk | re-add the constraint after deleting extra rows (only if no customer has two) |
| 5 | UI: number filters, per-number analytics, plan-limit enforcement | customer acceptance test | hide via flag |

Rules that make this safe:

- **Additive first, destructive last.** The constraint drop is phase 4, after
  every reader is number-aware. Old code against the new schema is always fine.
- **One flag** (`MULTI_WHATSAPP_ENABLED`) gates *creation* only. Reads must work
  with many numbers regardless, so a rollback never breaks data.
- **Never delete a number row** on “disconnect” — set `is_active = false` so
  historical conversations keep a resolvable sender.
- **Plan limit** is enforced at creation: `limits.channels` counts distinct
  active channels, with WhatsApp numbers counted individually inside it.

## 4. UI shape

**Settings → WhatsApp** becomes a list, not a form:

```
┌────────────────────────────────────────────────────────────┐
│ أرقام واتساب                        [+ إضافة رقم]           │
├────────────────────────────────────────────────────────────┤
│ ● +20 106 891 0995   Hemocure · WABA 1029…   [الرقم الأساسي]│
│   نشط · آخر رسالة قبل ٣ دقايق      ⋯  (تعيين كافتراضي/فصل) │
├────────────────────────────────────────────────────────────┤
│ ● +20 101 234 5678   Hemocure - الفرع        [افتراضي؟]     │
│   خطأ: التوكن منتهي · أعد الربط    ⋯                        │
└────────────────────────────────────────────────────────────┘
```

- **Add number** reuses the existing Embedded Signup flow unchanged; the only
  new thing is that the upsert keys on `(account_id, phone_number_id)`.
- **Status chip** per number: نشط / خطأ (with `last_error`) / غير مسجل.
- **Inbox**: channel chips stay (واتساب / ماسنجر / إنستجرام). When an account has
  more than one WhatsApp number, a second row of chips appears: «كل الأرقام /
  رقم ١ / رقم ٢». The thread header shows the receiving number.
- **Composer**: replies default to the conversation’s number — no selector on
  every message. A «من:» selector appears only when composing a **new**
  conversation or a broadcast.
- **Broadcast / templates**: a required number selector at creation, defaulting
  to the account default.
- **Dashboard**: volume grouped by number when > 1.

## 5. Tests to write before phase 4

- Unit: `getDefaultWhatsAppConfig` returns the flagged row; if none is flagged it
  falls back to the oldest active row and never throws on zero rows.
- Unit: conversation → number resolution (`conversation.whatsapp_config_id`
  wins, default otherwise).
- Regression: `send-message`, `broadcast-core`, `automations/meta-send`,
  `ai/auto-reply` all receive the resolved `phone_number_id`.
- Route: inbound webhook with two configs on the same account routes each
  `phone_number_id` to the right tenant (extend the existing
  “Multiple configs found” test).
- Live: two numbers on one account, one message each way, assert the Graph send
  used the matching `phone_number_id` (log line, not assumption).

## 6. Estimate

Phase 0–1 ≈ 6–8 h · phase 2 ≈ 2 h · phase 3 ≈ 4 h · phase 4 ≈ 3 h ·
phase 5 ≈ 6–8 h · tests throughout. **~22–27 h**, matching the 15–25 h quoted
on chat, with the extra hours for the regression matrix.
