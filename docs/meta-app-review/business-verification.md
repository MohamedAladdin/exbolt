# Business Verification — what it needs, in order

Business Verification is a **Meta Business** step, not an App Review step, and
it must finish before advanced access is granted. Start it first; it is the
long pole (typically 2–10 business days).

## 1. Own the app from the business

The app must belong to the Business Manager account being verified:
`business.facebook.com` → **Business Settings → Accounts → Apps** → the ExBolt
app should be listed. If it is not, add it there first. The person submitting
verification must be an **admin** of both the business and the app.

## 2. Documents to have ready (Egypt)

Pick the document that matches how the company is registered, and make sure the
**legal name, address and phone number match exactly** across the document, the
Business Manager profile and the domain:

- Commercial Register (السجل التجاري) — preferred
- Tax card (البطاقة الضريبية) — accepted as a secondary document
- A recent utility bill or bank statement in the company's legal name, if the
  address on the register is not current

Screenshots of a website do not count. Blurred or cropped documents are rejected.

## 3. Domain ownership

Verification asks you to prove control of `excal.uk`. The easiest proof is a
mailbox on that domain — `info@excal.uk` already receives mail through Cloudflare
Email Routing, so choose **email verification** and complete the code step.
The DNS/HTML-file routes work too, but the email route is the least disruptive.

## 4. Profile fields to fill before submitting

`Business Settings → Business info`:

| Field | Value |
|---|---|
| Legal name | as printed on the commercial register |
| Address | as printed on the register |
| Phone | a number reachable during review |
| Website | `https://excallabs.com` |
| Primary contact | `info@excal.uk` |

## 5. Common rejection reasons

- Legal name differs from the uploaded document by a suffix or transliteration
  (pick one spelling and use it everywhere)
- Phone number unreachable / no answer during the review window
- Domain email not verified because the mailbox bounces
- Submitting a personal ID instead of a company document
- Two Business Managers claiming the same app

## 6. What to expect

- Submission → usually a decision within 2–10 business days
- A rejection is not final: it names the field that failed, and resubmission is
  allowed immediately
- After approval, **App Review** requests for messaging permissions can complete
