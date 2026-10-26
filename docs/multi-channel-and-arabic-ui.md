# Multi-channel inbox, contact peek, Arabic UI, slash quick replies

Status: implemented (v1) · Migration: `060_multi_channel_inbox`, `061_redeem_invitation_channel_configs`

This document is the spec + decision record for the five changes requested on
2026-10-26. Each section states the requirement, what shipped, the boundaries
(what is deliberately *not* in v1) and how it is verified.

---

## 1. Messenger + Instagram as first-class inbox channels

**Requirement.** Add Messenger and Instagram DM to the inbox, with a clear
separation between the channels.

**Data model (`060_multi_channel_inbox.sql`).** A channel is a transport, not a
tenant: everything stays in one account, one contact book, one inbox.

| Column | Meaning |
|---|---|
| `contacts.channel` | `whatsapp` \| `messenger` \| `instagram`, default `whatsapp` |
| `contacts.channel_user_id` | PSID (Messenger) / IGSID (Instagram) — the addressing id |
| `conversations.channel` | mirrors the contact's channel; **the send path dispatches on it** |
| `channel_configs` | one row per (account, channel): Page id, encrypted token, active flag |

Unique index `(account_id, channel, channel_user_id)` is the webhook's
idempotency key: a Meta retry can never fork a second thread for the same
person. WhatsApp keeps using `phone` + `wa_user_id`, untouched.

**Inbound.** The Meta app delivers `object: "page"` / `object: "instagram"` to
the *existing* callback URL (`/api/whatsapp/webhook`), so the channel is decided
from the payload itself (`channelForWebhookObject`). The route acks immediately
and processes in `after()`, exactly like the WhatsApp path. Parsing is pure and
unit-tested (`src/lib/channels/inbound.ts`); persistence
(`src/lib/channels/process-inbound.ts`) reuses the same invariants as WhatsApp:
oldest-first find-or-create, `bump_conversation_on_inbound` RPC for the unread
counter, reopen-on-inbound, inbound media mirrored into `chat-media`.

**Outbound.** `sendMessageToConversation` branches on `conversations.channel`
before any WhatsApp-specific work and hands off to the Send API
(`graph-api.ts`): `POST /{page|ig-id}/messages` with `messaging_type: RESPONSE`.
Templates and interactive messages are rejected with a clear `bad_request` on
these channels — Meta has no equivalent, and pretending otherwise would produce
silent failures.

**Separation in the UI.** Channel chip in the thread header (always shown,
WhatsApp included), corner dot + chip on list rows for non-WhatsApp threads, and
a channel filter (All / WhatsApp / Messenger / Instagram with counts) that only
appears once the account runs more than one transport.

**Not in v1 (explicit).** OAuth "connect with Facebook"; per-channel analytics;
reactions/read receipts for FB/IG; Messenger story replies and mentions;
multi-Page per account.

**Verification.** `src/lib/channels/inbound.test.ts` (parsing, echo/receipt
filtering, postback, multi-entry). Manual: send a signed `page` payload with
`META_APP_SECRET` set and confirm the thread appears under the Messenger filter.

---

## 2 + 3. Phone numbers in a message are contact cards

**Requirement.** (2) Clicking a phone number inside a conversation shows the
contact's data when available. (3) You can start a chat from that number without
a detour through Contacts — the contact is created automatically.

**Detection.** `src/lib/contacts/phone-detect.ts` — conservative on purpose: a
false positive turns an order id into a "call this person" affordance. Accepts
`+…`, `00…`, and local trunk-0 numbers (promoted with
`NEXT_PUBLIC_DEFAULT_COUNTRY_CODE`, default `20`); rejects dates, URLs,
short/placeholder runs.

**Rendering.** `LinkedText` replaces the plain `<p>` in every message body
(text, captions, template bodies, interactive bodies), keeping
`whitespace-pre-wrap break-words`. Phone runs become a button that opens
`ContactPeek` (Base UI popover): name, phone, email, company, tags, channel.

**Route 1 — `GET /api/contacts/lookup?phone=`.** Read-only. Fuzzy match through
the same dedupe helper the contact form uses, plus the existing conversation id
so the card can say "Open conversation" instead of "Chat now".

**Route 2 — `POST /api/contacts/open-chat {phone, name?}`.** Wraps
`resolveConversationByPhone` (already used by the public API): find-or-create
contact → find-or-create conversation → return the conversation id. The inbox
listens for a `wacrm:open-conversation` window event, pulls the row with its
contact join and selects it, so the flow works even when the thread is not in
the current list page.

**Verification.** `phone-detect.test.ts` (11 cases: international, local, `00`,
dates, URLs, prices, two numbers, ambiguous). Manual: click a number in a thread
with no matching contact → "Chat now" → contact + conversation created.

---

## 4. Arabic UI, RTL and typography controls

**Requirement.** Easy switch from English to Arabic, RTL, better Arabic
typeface/size, and the option lives in Settings.

**Locale is a runtime choice, not a build variable.** Upstream resolved the
catalogue at build time from `NEXT_PUBLIC_APP_LOCALE`. That cannot support a
switch, so the order is now: cookie (`wacrm_locale`) → env default → English
(`src/i18n/config.ts`, `resolveLocale`). `POST /api/locale` writes the cookie;
the Appearance panel then paints `lang`/`dir` optimistically and calls
`router.refresh()`, so every server-rendered string re-renders without a reload.

The catalogues are **statically** imported in `src/i18n/request.ts`: a
template-literal dynamic import is not statically analysable by Turbopack in a
server bundle, so a locale that only exists at runtime can fail in production
while working in dev.

**Arabic catalogue.** `messages/ar.json` mirrors `en.json` key-for-key
(parity + ICU placeholder signature enforced by `src/i18n/messages.test.ts`,
which now includes `ar`).

**RTL.** `<html dir="rtl">` for Arabic; physical Tailwind utilities were
converted to logical ones (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`,
`text-start`/`text-end`, `border-s`/`border-e`, `rounded-s-*`/`rounded-e-*`) so
the same components mirror correctly.

**Typography.** Three self-hosted Arabic faces via `next/font` (no third-party
request, no CSP hole): Cairo (default), Tajawal, Noto Kufi Arabic — plus a
four-step type scale that scales the whole rem-based UI. Both are device-scoped
(localStorage, replayed by the boot script before first paint) because they are
legibility choices, unlike the language, which is account-visible and therefore
a cookie.

**Verification.** Switch language to العربية in Settings → Appearance: `dir`
flips, all chrome is Arabic, numbers/phones stay LTR-tabular. Parity test:
`npx vitest run src/i18n/messages.test.ts`.

---

## 5. `/` in the composer opens a live quick-reply search

**Requirement.** Typing `/` in the message box opens the quick replies and
filters them as you type (`/اهلا` → every quick reply containing that word),
without leaving the keyboard.

**Matching.** `src/lib/inbox/quick-reply-search.ts`:

- `slashQueryAt(text, caret)` — only a `/` at the start of the text or after
  whitespace counts, so `https://` never opens the picker.
- `normalizeForSearch` — folds alef/ya/ta-marbuta variants and strips Arabic
  diacritics, so `/اهلا` finds "أهلاً بك".
- `filterQuickReplies` — ranking: title-prefix → title-contains → body-contains.

**UI.** An overlay above the composer (`SlashQuickReplies`), so the thread does
not jump. ↑/↓ move, Enter/Tab insert, Esc dismisses; Enter only sends when the
picker is closed. Picking an interactive snippet opens the builder prefilled,
same as the dialog picker. The catalogue is fetched on first use and cached for
the composer's lifetime.

**Verification.** `quick-reply-search.test.ts` (slash detection incl. URL
rejection, Arabic folding, ranking). Manual: type `/` then a word.

---

## Rollout notes

- Migrations must run **before** the app: `060` adds the columns the send path
  reads, `061` keeps account deletion honest with the new table.
- New env vars: `META_WEBHOOK_VERIFY_TOKEN` (app-level webhook verification for
  Page/IG subscriptions), `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` (default `20`),
  `META_GRAPH_VERSION` (default `v23.0`).
- `channel_configs.access_token` is encrypted with the same AES-256-GCM helper
  (and `ENCRYPTION_KEY`) as `whatsapp_config.access_token`; rotating the key
  orphans both.
