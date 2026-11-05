-- 105 — an optional signature on outgoing messages.
--
-- A team wants the customer to know who is talking: a name, a role, the
-- clinic's line. The signature is one template per account, appended to the
-- text body of every outgoing message the business writes itself.
--
-- Defaults keep the feature invisible until somebody chooses it:
--   * `signature_enabled = false` — every message goes out exactly as typed,
--     so deploying this changes the body of exactly zero messages.
--   * `signature_template = '{{ agent_name }}'` — the sender's own name,
--     which is what a signature means for a team inbox. It is *not* applied
--     while the feature is off; it is only the first thing the screen shows
--     when an admin turns it on.
--
-- What the signature never touches:
--   * Meta templates — their body is approved by Meta and cannot be edited,
--   * interactive button/list payloads — structured, not prose.
-- Placeholders are resolved at send time by src/lib/whatsapp/signature.ts:
--   `{{ agent_name }}`     → the teammate who sent it (falls back to the
--                            account name when nobody is known, e.g. the
--                            public API),
--   `{{ business_name }}`  → `accounts.name`.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS signature_enabled  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signature_template TEXT    NOT NULL DEFAULT '{{ agent_name }}';

-- A signature is a signature, not a second message. 300 chars is already
-- generous for a name + number + line; anything longer is a body typed into
-- the wrong box, and the cap belongs in the database rather than only in the
-- form so a direct API write cannot ship a wall of text on every reply.
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_signature_template_length;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_signature_template_length
  CHECK (char_length(signature_template) <= 300);

COMMENT ON COLUMN public.accounts.signature_enabled IS
  'When true, every outgoing text message is signed with signature_template';
COMMENT ON COLUMN public.accounts.signature_template IS
  'Signature body appended to outgoing text messages; supports {{ agent_name }} and {{ business_name }}';
