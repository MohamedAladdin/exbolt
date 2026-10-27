# Screencast script — 3 to 5 minutes

Meta rejects videos that cut, hide the browser chrome, or never show the
permission actually being used. Record the whole screen **including the address
bar**, do the flow in one take, and narrate in English.

Prep before recording:
- Browser window 1440×900, zoom 100%, no bookmarks bar clutter
- Signed out of ExBolt, then sign in normally (so the reviewer sees login)
- A second Facebook account (a friend/colleague) available to send a test
  message — that is what proves end-to-end delivery
- Close Discord/Slack/email notifications

---

## Shot 1 — who we are (0:00–0:20)

**On screen:** `https://bolt.excal.uk/login`, then sign in.
**Narration:**
> "This is ExBolt, a shared inbox for a business's own WhatsApp, Messenger and
> Instagram conversations. I'm signing in to a workspace as its admin."

## Shot 2 — connect a Page (0:20–1:10)

**On screen:** Settings → Channels → **Connect with Facebook**. The Facebook
dialog appears; pause two seconds on the permission list, then continue.
**Narration:**
> "Connecting a channel starts with Facebook Login. We request pages_show_list
> so the admin can pick the Page they manage, pages_messaging to read and answer
> their Messenger conversations, and pages_manage_metadata so the Page is
> subscribed to our webhook. These are the Page's own conversations — the admin
> is the owner of the Page."

## Shot 3 — choose the Page (1:10–1:40)

**On screen:** the chooser lists Pages; select `TechTron`; return to Settings,
which now shows **Connected · TechTron · ID**.
**Narration:**
> "Only Pages this person administers are listed, and only the one they select is
> stored — encrypted at rest. The subscription call runs in the same step."

## Shot 4 — prove the messaging permission (1:40–2:40)

**On screen:** Inbox → channel filter **Messenger** → open the thread → send a
reply → show it delivered. Then have the second account send a new message and
show it arriving live.
**Narration:**
> "This is the inbox. Here is an inbound Messenger message from a customer, and
> here is my reply going out through the same Page. The channel filters keep
> WhatsApp, Messenger and Instagram conversations separated, and each workspace
> only ever sees its own."

## Shot 5 — Instagram (2:40–3:20) — only if requesting the Instagram permissions

**On screen:** Settings → Channels → Connect with Facebook for Instagram → pick
the professional account linked to the Page → open the Instagram thread.
**Narration:**
> "The same flow connects the Instagram professional account linked to the Page,
> using instagram_basic to identify it and instagram_manage_messages to answer
> Direct messages."

## Shot 6 — WhatsApp Embedded Signup (3:20–4:20) — only if requesting the WhatsApp permissions

**On screen:** Settings → WhatsApp → **Connect with Facebook** → the Meta-hosted
Embedded Signup dialog → select the WABA and the phone number → return to
Settings showing the number, WABA id and status → send an approved template.
**Narration:**
> "For WhatsApp the customer picks their own WhatsApp Business Account and phone
> number inside Meta's Embedded Signup dialog. We store the ids and an encrypted
> token, subscribe the WABA to our webhook, and use
> whatsapp_business_messaging to send an approved template."

## Shot 7 — close (4:20–4:40)

**On screen:** back to the inbox, both channels visible.
**Narration:**
> "That is the whole product: a business connects its own assets with Facebook
> Login or Embedded Signup, and answers its customers from one inbox. No assets
> are ever connected on a customer's behalf."

---

## Do not show

- Access tokens, app secrets, `.env` files, or the Supabase dashboard
- Another customer's conversations
- Cuts, sped-up sections, or a hidden address bar
- Screen recordings of slides — the reviewer must see the working product
