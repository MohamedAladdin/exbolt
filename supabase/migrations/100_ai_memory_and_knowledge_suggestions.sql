-- 100 — what the assistant remembers, and what it is allowed to propose.
--
-- Two additions, both deliberately narrow:
--
-- 1) contact_facts — a handful of durable facts about ONE customer (preferred
--    branch, patient name, file number…). Injected into the prompt as
--    reference, so the bot stops re-asking what the customer already said
--    (the model itself is stateless and sees only the last 20 messages).
--    Facts are written by the extractor job or by a human, never by the
--    model in a live conversation.
--
-- 2) ai_knowledge_suggestions — question/answer pairs lifted from real
--    conversations where a HUMAN answered. They land as `draft` and become
--    knowledge-base documents only after an admin approves them: the bot may
--    propose what it should learn, it may never quietly teach itself.
--
-- Neither table grants the model any capability: the assistant is a plain
-- text-completion call with no tools. These tables are rows in Postgres that
-- a human-reviewed job writes and a prompt reads.

CREATE TABLE IF NOT EXISTS public.contact_facts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- Stable machine key ('preferred_branch', 'patient_name', …) so a new value
  -- replaces the old instead of piling up.
  fact_key    TEXT NOT NULL CHECK (char_length(fact_key) BETWEEN 1 AND 64),
  fact_value  TEXT NOT NULL CHECK (char_length(fact_value) BETWEEN 1 AND 500),
  -- 'auto' = extracted from a conversation; 'manual' = typed by a teammate.
  source      TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  confidence  NUMERIC(3, 2) NOT NULL DEFAULT 0.80
              CHECK (confidence >= 0 AND confidence <= 1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contact_id, fact_key)
);

CREATE INDEX IF NOT EXISTS idx_contact_facts_contact
  ON public.contact_facts(account_id, contact_id);

ALTER TABLE public.contact_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_facts_select ON public.contact_facts;
DROP POLICY IF EXISTS contact_facts_write ON public.contact_facts;
CREATE POLICY contact_facts_select ON public.contact_facts FOR SELECT
  USING (is_account_member(account_id));
-- Humans may correct the machine: admins/owners delete or edit a wrong fact.
CREATE POLICY contact_facts_write ON public.contact_facts FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- Throttle for the extractor: when this contact's facts were last refreshed.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS ai_facts_extracted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.contacts.ai_facts_extracted_at IS
  'Last time the AI fact extractor ran on this contact (weekly refresh throttle)';

-- ============================================================
-- Knowledge suggestions (human-approved learning)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_knowledge_suggestions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  question                TEXT NOT NULL CHECK (char_length(question) BETWEEN 3 AND 500),
  answer                  TEXT NOT NULL CHECK (char_length(answer) BETWEEN 3 AND 4000),
  -- Where it came from, so a reviewer can check the source thread.
  source_conversation_id  UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'approved', 'dismissed')),
  reviewed_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at             TIMESTAMPTZ,
  -- The KB document created on approval (null while draft / when dismissed).
  document_id             UUID REFERENCES public.ai_knowledge_documents(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Same question from the same account is only proposed once.
  UNIQUE (account_id, question)
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_suggestions_draft
  ON public.ai_knowledge_suggestions(account_id, created_at DESC)
  WHERE status = 'draft';

ALTER TABLE public.ai_knowledge_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_suggestions_select ON public.ai_knowledge_suggestions;
DROP POLICY IF EXISTS ai_suggestions_review ON public.ai_knowledge_suggestions;
CREATE POLICY ai_suggestions_select ON public.ai_knowledge_suggestions FOR SELECT
  USING (is_account_member(account_id));
-- Reviewing = approving/dismissing, an admin act. Inserts come from the job
-- (service role, bypasses RLS), never from the client.
CREATE POLICY ai_suggestions_review ON public.ai_knowledge_suggestions FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
