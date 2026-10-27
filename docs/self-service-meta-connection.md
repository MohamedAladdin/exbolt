# Self-service Meta connection (WhatsApp / Messenger / Instagram)

Settings → Channels and Settings → WhatsApp now open with **Connect with
Facebook**. The customer signs in with the Facebook account that owns their
Page or WhatsApp Business account, and ExBolt resolves the rest — no Page IDs
or access tokens pasted by hand. The manual form is still there, collapsed
under **الإعداد اليدوي / Set up manually**, for customers who already hold a
long-lived token.

## What each flow does

| Channel | Scopes | Stored |
| --- | --- | --- |
| `whatsapp` | `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management` | `whatsapp_config`: `waba_id`, `phone_number_id`, encrypted token, `status = connected` |
| `messenger` | `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `business_management` | `channel_configs`: Page id + encrypted Page token |
| `instagram` | `instagram_basic`, `instagram_manage_messages`, `pages_show_list`, `business_management` | `channel_configs`: the Page's `instagram_business_account.id` + encrypted **Page** token |

Both Page channels subscribe the Page to this app's webhook
(`POST /{page-id}/subscribed_apps`); the WhatsApp flow subscribes the WABA
(`POST /{waba-id}/subscribed_apps`). Tokens are encrypted with
`ENCRYPTION_KEY` (AES-256-GCM, `src/lib/whatsapp/encryption.ts`) before they
are written, and never appear in a URL, a log line or an API response.

If the authorizing account manages several Pages, the callback sends the
browser to `/settings/channels/choose`, which lists them and stores only the
one picked. The Page tokens are never sent to the browser — the callback
leaves a sealed (encrypted) **user** token in an httpOnly cookie and the
chooser re-reads the Page list server-side.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `META_APP_ID` | yes | Facebook app id (dialog `client_id`) |
| `META_APP_SECRET` | yes | code → token exchange. A comma-separated list is accepted; the first entry is used |
| `META_OAUTH_REDIRECT_URI` | no | Defaults to `https://bolt.excal.uk/api/oauth/meta/callback`. Must match a Valid OAuth Redirect URI **exactly** |
| `META_ES_CONFIG_ID` | WhatsApp only | Embedded Signup configuration id (see below) |
| `META_GRAPH_VERSION` | no | Defaults to `v23.0` |
| `ENCRYPTION_KEY` | yes | 64 hex chars. Encrypts tokens **and** signs the OAuth `state` |

With `META_APP_ID` or `META_APP_SECRET` missing, `/api/oauth/meta/start` and
the callback answer `503` with `code: "meta_oauth_not_configured"` and the
Settings screen keeps working through the manual form.

The state cookie is `Secure`, so the flow needs HTTPS. `http://localhost` is
treated as trustworthy by browsers and works in `next dev`; a plain-HTTP LAN
address (e.g. `http://192.168.x.x:3000`) does not, and the callback will land
on `?error=state`.

## Meta app dashboard checklist

1. **Facebook Login** product enabled (Products → Facebook Login → Settings).
   The manual flow never needed it; the button does.
2. **App settings → Basic**: copy the App ID and App secret into
   `META_APP_ID` / `META_APP_SECRET`.
3. **Facebook Login → Settings → Valid OAuth Redirect URIs**: add the callback
   URL exactly, e.g. `https://bolt.excal.uk/api/oauth/meta/callback`. A
   trailing slash or `http://` mismatch fails with
   `URL Blocked: This redirect failed…` before ExBolt is ever reached.
4. **App Review / Permissions**: the scopes in the table above must be
   granted for the app (they work without review only for users with a role on
   the app). `business_management` is what lets the dialog list Business
   Manager assets instead of only personally-owned Pages.
5. **Webhooks**: keep the existing `/api/webhooks/meta` callback and subscribe
   to the `page`, `instagram` and `whatsapp_business_account` objects. The
   connect flow creates the per-asset subscription; the app-level webhook
   config is still manual.
6. **WhatsApp → Embedded Signup**: create an Embedded Signup configuration
   (WhatsApp → Embedded Signup → Configurations) and put its id in
   `META_ES_CONFIG_ID`. Without it the WhatsApp dialog opens as a plain OAuth
   consent screen and returns no `waba_id` / `phone_number_id`, which ExBolt
   reports as `error=setup`.

Instagram: the Instagram account must be a professional account linked to the
Page. A Page without a linked IG business account is rejected
(`error=no_instagram`) rather than stored half-wired.

## Security properties

- `state` is `base64url(json).base64url(HMAC-SHA256)` over
  `{channel, account_id, nonce, iat}`, keyed with `ENCRYPTION_KEY`, valid for
  **10 minutes**, and pinned to an httpOnly + `Secure` + `SameSite=Lax`
  cookie (`meta_oauth_state`). The callback needs the cookie *and* a valid
  signature, and the account inside the state must still match the session.
- The callback re-checks `requireFeature('inbox', 'admin')`, so a suspended
  plan or a downgraded user cannot complete a connection started earlier.
- Redirects carry only `?connected=<channel>` or `?error=<code>`.

Error codes surfaced on Settings (`Settings.*.oauth.error.*` in
`messages/en.json` / `ar.json`):

`state`, `state_expired`, `denied`, `forbidden`, `plan`, `no_pages`,
`no_instagram`, `linked_elsewhere`, `number_taken`, `phone_not_found`,
`setup`, `exchange`, `db`, `generic`.

## Tests

`src/lib/oauth/meta.test.ts` covers the dialog URL (per-channel scopes,
`config_id` only for WhatsApp), the HMAC state (valid / tampered / expired /
future-dated), the Page → `channel_configs` mapping (including the Instagram
account requirement and an encrypt/decrypt round trip) and Page-list
sanitisation.
