# Ready-to-paste permission justifications (English)

Paste one block per permission in **App Review → Permissions and features →
Request advanced access**. Keep the video link in the dedicated field.
Each block is written to answer the three things a reviewer checks: **which
endpoint**, **which screen the end user sees**, and **who can see the data**.

> Do not add features that are not in the build. Every sentence below maps to
> code that is already deployed on `https://bolt.excal.uk`.

---

## pages_show_list

ExBolt is a shared inbox for a business's own messaging channels. When an admin
signs in with Facebook, we call `GET /me/accounts` to list only the Facebook
Pages that this person already administers, and render them in a chooser screen
(Settings → Channels → "Choose a Page"). We use the returned name, id, category
and picture solely to render that list. Nothing is stored for Pages the admin
does not select, and the list is never shared with other tenants.

---

## pages_messaging

We use it for the core product feature: receiving and answering the Messenger
conversations sent to the connected Page, via `GET /{page-id}/conversations`,
`GET /{conversation-id}/messages` and `POST /{page-id}/messages`. Messages are
shown in the account's shared inbox only to members of the business workspace
that connected that Page (enforced by per-row security rules in the database).
No message content is used for advertising or profiling.

---

## pages_manage_metadata

We use it to subscribe the Page the admin connected to our app's webhook —
`POST /{page-id}/subscribed_apps` with `subscribed_fields=messages,
messaging_postbacks,message_reactions` — and to read the current subscription
state so the settings screen can show "Connected". Without this call the Page
never delivers new messages to our webhook, so the inbox would stay empty.

---

## instagram_basic

After the admin connects a Page, we read the Instagram professional account
linked to it (`instagram_business_account` field) and use only its id, username
and profile picture to label the Instagram channel in the inbox and in the
channel settings screen.

---

## instagram_manage_messages

We use it to receive and answer Instagram Direct messages for the connected
professional account, through the same send API used for Messenger
(`POST /{ig-user-id}/messages`). Conversations are visible only to members of
the workspace that connected the account.

---

## business_management

We use it to identify which business owns the Page/Instagram account being
connected, so an asset can be attributed to exactly one ExBolt workspace and
cannot be connected a second time to a different workspace (we block that
explicitly). We do not create, edit or delete any business asset.

---

## whatsapp_business_management

Used for WhatsApp Embedded Signup onboarding: the customer selects their
WhatsApp Business Account and phone number inside the Meta-hosted dialog; we
then read the WABA and phone-number ids, read template status, and register the
number so it can send messages. We do not create WABAs on the customer's behalf.

---

## whatsapp_business_messaging

Used to send and receive WhatsApp messages for the phone number the customer
connected — `POST /{phone-number-id}/messages` for replies, approved templates
for business-initiated messages, and webhook delivery for inbound messages.
Content stays inside the customer's own workspace.

---

## Notes for the reviewer field "How will this permission be used in your app?"

If the form gives you one combined box, paste the blocks for the permissions you
are requesting together, separated by blank lines, and start with this paragraph:

> ExBolt is a multi-tenant shared inbox for businesses that want to answer their
> own WhatsApp, Messenger and Instagram conversations in one place. Each
> customer connects their own assets through Facebook Login or WhatsApp Embedded
> Signup; ExBolt never connects assets on a customer's behalf. All message data
> is isolated per workspace with row-level security, and access tokens are
> encrypted at rest (AES-256-GCM).
