# Editing and forwarding messages in the inbox

Two inbox actions that WhatsApp's Cloud API does **not** provide, and how
ExBolt makes them behave honestly.

## The constraint

The WhatsApp Business Platform Messages API has no edit endpoint, no
delete/revoke endpoint and no forward endpoint. Meta has an open feature
request for edit + delete on the developer community ("WhatsApp Cloud API –
Request for Edit and Delete Message Support"), and the official changelog
through **October 30, 2026** contains no such capability.

Native WhatsApp (the consumer/Business app) lets a user edit their own
message for ~15 minutes. That is a client feature with no API surface, so a
CRM cannot trigger it.

Forwarding on WhatsApp is likewise a client action: it re-sends the same
payload to another chat. That one *can* be reproduced server-side, because
it is just another send.

## Edit (`POST /api/whatsapp/messages/{id}/edit`)

The dialog picks one of two paths based on the message itself
(`src/lib/whatsapp/message-edit.ts`):

| Message state | Path | What happens |
|---|---|---|
| Outbound, `status = failed`, plain text | **in place** | Corrected text replaces the row, the message is re-sent, `edited_at` is stamped, the old failure reason is cleared. One bubble — no failed twin, no duplicate. |
| Outbound, delivered/sent/read (or media/template/interactive) | **correction** | A new message quoting the original is sent (`تصحيح لما سبق: …` / `Correction: …`), and the original is stamped `edited_at` + `correction_message_id` and shows «صُحّحت». |
| Inbound (customer) | blocked | The CRM never rewrites what the customer wrote. |

Implementation notes:

- the in-place path reuses the shared send core
  (`sendMessageToConversation(..., { replaceMessageId })`), so templates,
  the 24-hour window, phone-variant retry, encryption, quota and Flow
  pausing all behave exactly as for a normal send;
- the correction prefix follows the agent's UI locale and the dialog states
  up front that a correction — not an edit — is about to be sent;
- editing shares the send rate-limit bucket (`send:<userId>`), so it cannot
  be used to bypass the send budget.

## Forward (`POST /api/whatsapp/forward`)

`forwardPayloadFor()` turns a stored message into a re-send payload:

- text / template / interactive → their rendered text;
- image, video, document, audio → the durable `chat-media` URL (the same
  envelope the composer uploads), caption included except for audio, which
  Meta rejects a caption on;
- anything without text or with a media URL that is not http(s) (an expired
  signed URL, or a raw Meta media id) is refused **before** sending, with a
  specific reason instead of a Meta 400.

The picker (`GET /api/whatsapp/forward/targets`) lists the account's most
recent conversations; up to **five** can be selected per forward (WhatsApp's
own multi-forward cap). Each new row carries `forwarded_from_message_id`
(rendered as the forward marker) and the source row's `forward_count` is
bumped.

Partial success is a first-class result: the response is
`{ sent: [...], failed: [...] }`, and a forward that reaches nobody returns
400 with the first failure reason.

## Schema

`supabase/migrations/066_message_edit_and_forward.sql`:

- `messages.edited_at`
- `messages.correction_message_id` → `messages(id)`
- `messages.forwarded_from_message_id` → `messages(id)`
- `messages.forward_count`

All nullable/defaulted, so older code against the new schema is safe —
apply the migration **before** deploying the build.
