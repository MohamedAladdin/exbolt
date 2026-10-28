-- ============================================================
-- 070_account_activity_log
--
-- The tenant-side counterpart of `admin_audit_log`: an append-only
-- record of WHO changed WHAT inside one account — settings,
-- integrations, content and member assignments.
--
-- Why triggers instead of `logActivity()` calls in each API route:
--   * every write path is covered, including client-side Supabase
--     writes (inbox assignment, tags, deals) and any route added
--     later — "nobody can dodge the blame" cannot depend on a
--     developer remembering to instrument a new endpoint;
--   * the actor is `auth.uid()` *at write time*, taken from the
--     JWT, not from anything the browser can set;
--   * a failed log never blocks the mutation it describes.
--
-- Values are diffed field-by-field in the trigger, so the UI can
-- show "access_token: ••• → •••" without the app having to know
-- what the before-state was. Secrets are masked in SQL, always.
--
-- Idempotent: safe to re-run. Retrofitting an event after a rewrite
-- of a route is impossible, so the trigger set is the contract.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_activity_log (
  id            BIGSERIAL PRIMARY KEY,
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Actor snapshot. Kept as text so the row still explains itself
  -- after the user renames themselves or is removed from the team.
  actor_user_id UUID,
  actor_name    TEXT,
  actor_email   TEXT,
  actor_role    account_role_enum,
  -- 'app' = a signed-in person did it; 'system' = no auth.uid()
  -- (cron, webhook, flow engine, service-role admin).
  source        TEXT NOT NULL DEFAULT 'app'
                  CHECK (source IN ('app', 'system')),
  action        TEXT NOT NULL,
  category      TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  target_label  TEXT,
  -- {"field": {"from": …, "to": …}} — already masked + clipped.
  changes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_activity_account_time
  ON account_activity_log(account_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_account_activity_account_category
  ON account_activity_log(account_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_activity_account_actor
  ON account_activity_log(account_id, actor_user_id, created_at DESC);

-- ------------------------------------------------------------
-- 2. RLS — admins read, nobody writes by hand.
--
-- There is deliberately NO insert/update/delete policy: rows can
-- only be produced by the SECURITY DEFINER trigger functions below,
-- so a tenant cannot forge or erase an entry from the browser.
-- ------------------------------------------------------------
ALTER TABLE account_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_activity_read_admin ON account_activity_log;
CREATE POLICY account_activity_read_admin ON account_activity_log
  FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'admin'));

GRANT SELECT ON account_activity_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE account_activity_log_id_seq TO authenticated;

-- Distinct actors, for the "who" filter. `security_invoker` so the
-- caller's RLS still decides what they can aggregate.
CREATE OR REPLACE VIEW account_activity_actors
WITH (security_invoker = true) AS
  SELECT account_id,
         actor_user_id,
         max(actor_name)  AS actor_name,
         max(actor_email) AS actor_email,
         count(*)         AS events,
         max(created_at)  AS last_seen
    FROM account_activity_log
   GROUP BY account_id, actor_user_id;

GRANT SELECT ON account_activity_actors TO authenticated;

-- ------------------------------------------------------------
-- 3. Helpers
-- ------------------------------------------------------------

-- Long text (prompts, knowledge bodies) is useless in a log and
-- expensive to keep: clip to 280 chars.
CREATE OR REPLACE FUNCTION public.activity_clip(p JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    WHEN jsonb_typeof(p) = 'string'
         AND length(p #>> '{}') > 280
      THEN to_jsonb(left(p #>> '{}', 277) || '…')
    ELSE p
  END
$$;

-- Columns that never belong in a diff: primary key, tenant key,
-- bookkeeping timestamps and counters the engine bumps on its own.
CREATE OR REPLACE FUNCTION public.activity_skip_columns()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'id', 'account_id', 'created_at', 'updated_at',
    'last_used_at', 'last_delivery_at', 'failure_count',
    'execution_count', 'last_executed_at', 'quality_score'
  ]
$$;

-- ------------------------------------------------------------
-- 4. The generic row logger
--
--   TG_ARGV[0] action on INSERT
--   TG_ARGV[1] action on UPDATE
--   TG_ARGV[2] action on DELETE
--   TG_ARGV[3] category
--   TG_ARGV[4] target_type
--   TG_ARGV[5] label column ('' = none)
--   TG_ARGV[6] comma-separated extra sensitive columns ('' = none)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_activity_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new        JSONB;
  v_old        JSONB;
  v_changes    JSONB := '{}'::jsonb;
  v_action     TEXT;
  v_account    UUID;
  v_actor      UUID := auth.uid();
  v_actor_name TEXT;
  v_actor_email TEXT;
  v_actor_role account_role_enum;
  v_label      TEXT;
  v_target_id  TEXT;
  v_sensitive  TEXT[];
  v_key        TEXT;
BEGIN
  v_sensitive := string_to_array(coalesce(nullif(TG_ARGV[6], ''), ''), ',');

  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD) - activity_skip_columns();
    v_action := TG_ARGV[2];
  ELSE
    v_new := to_jsonb(NEW) - activity_skip_columns();
    v_action := TG_ARGV[0];
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD) - activity_skip_columns();
    SELECT COALESCE(
             jsonb_object_agg(
               e.key,
               jsonb_build_object(
                 'from', activity_clip(v_old -> e.key),
                 'to',   activity_clip(e.value)
               )
             ),
             '{}'::jsonb
           )
      INTO v_changes
      FROM jsonb_each(v_new) AS e
     WHERE v_old -> e.key IS DISTINCT FROM e.value;

    -- Nothing meaningful changed (e.g. the engine touched updated_at
    -- only) → keep the log honest and stay silent.
    IF v_changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;

    v_action := TG_ARGV[1];
  END IF;

  -- Mask secrets. `access_token` is both a column name and a pattern;
  -- the pattern catches future columns without a migration.
  FOR v_key IN SELECT jsonb_object_keys(v_changes) LOOP
    IF v_key = ANY (v_sensitive)
       OR v_key ~* '(secret|token|password|api_key|key_hash|credential)' THEN
      v_changes := jsonb_set(
        v_changes, ARRAY[v_key],
        '{"from": "•••", "to": "•••"}'::jsonb, true
      );
    END IF;
  END LOOP;

  -- Tenant key.
  IF TG_TABLE_NAME = 'accounts' THEN
    v_account := COALESCE(NEW.id, OLD.id);
  ELSE
    v_account := COALESCE(NEW.account_id, OLD.account_id);
  END IF;
  IF v_account IS NULL THEN
    RETURN NULL;
  END IF;

  v_target_id := COALESCE(NEW.id, OLD.id)::text;

  -- Human label for the row (template name, key name, phone number…).
  IF COALESCE(TG_ARGV[5], '') <> '' THEN
    BEGIN
      IF TG_OP = 'DELETE' THEN
        EXECUTE format('SELECT ($1).%I::text', TG_ARGV[5])
          INTO v_label USING OLD;
      ELSE
        EXECUTE format('SELECT ($1).%I::text', TG_ARGV[5])
          INTO v_label USING NEW;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_label := NULL;
    END;
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT full_name, email, account_role
      INTO v_actor_name, v_actor_email, v_actor_role
      FROM profiles
     WHERE user_id = v_actor;
  END IF;

  INSERT INTO account_activity_log (
    account_id, actor_user_id, actor_name, actor_email, actor_role,
    source, action, category, target_type, target_id, target_label,
    changes, metadata
  ) VALUES (
    v_account, v_actor, v_actor_name, v_actor_email, v_actor_role,
    CASE WHEN v_actor IS NULL THEN 'system' ELSE 'app' END,
    v_action, TG_ARGV[3], TG_ARGV[4], v_target_id, v_label,
    v_changes,
    jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP)
  );

  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- 5. Members — joins, role changes, removals
--
-- `remove_account_member` does not delete the profile: it moves the
-- user onto a fresh personal account. So "removed" arrives here as
-- an account_id change, and must be filed against the OLD account.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_member_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account    UUID;
  v_action     TEXT;
  v_label      TEXT;
  v_target_id  TEXT;
  v_changes    JSONB := '{}'::jsonb;
  v_actor      UUID := auth.uid();
  v_actor_name TEXT;
  v_actor_email TEXT;
  v_actor_role account_role_enum;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_account   := NEW.account_id;
    v_action    := 'members.joined';
    v_label     := NEW.full_name;
    v_target_id := NEW.user_id::text;
    v_changes   := jsonb_build_object(
      'account_role', jsonb_build_object('from', NULL, 'to', NEW.account_role)
    );

  ELSIF TG_OP = 'DELETE' THEN
    v_account   := OLD.account_id;
    v_action    := 'members.left';
    v_label     := OLD.full_name;
    v_target_id := OLD.user_id::text;

  ELSIF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    -- Removed by an admin (or left on their own) → filed against the
    -- account they are leaving.
    v_account   := OLD.account_id;
    v_action    := 'members.removed';
    v_label     := OLD.full_name;
    v_target_id := OLD.user_id::text;
    v_changes   := jsonb_build_object(
      'account_role', jsonb_build_object('from', OLD.account_role, 'to', NULL)
    );

  ELSIF NEW.account_role IS DISTINCT FROM OLD.account_role THEN
    v_account   := NEW.account_id;
    v_action    := 'members.role_changed';
    v_label     := NEW.full_name;
    v_target_id := NEW.user_id::text;
    v_changes   := jsonb_build_object(
      'account_role', jsonb_build_object(
        'from', OLD.account_role, 'to', NEW.account_role
      )
    );

  ELSE
    RETURN NULL;
  END IF;

  IF v_account IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT full_name, email, account_role
      INTO v_actor_name, v_actor_email, v_actor_role
      FROM profiles
     WHERE user_id = v_actor;
  END IF;

  INSERT INTO account_activity_log (
    account_id, actor_user_id, actor_name, actor_email, actor_role,
    source, action, category, target_type, target_id, target_label,
    changes, metadata
  ) VALUES (
    v_account, v_actor, v_actor_name, v_actor_email, v_actor_role,
    CASE WHEN v_actor IS NULL THEN 'system' ELSE 'app' END,
    v_action, 'members', 'member', v_target_id, v_label, v_changes,
    jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP)
  );

  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- 6. Conversation assignment
--
-- The only inbox event worth a permanent record: who took which
-- lead. Everything else in `conversations` changes on every
-- message and would drown the log.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_conversation_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       UUID := auth.uid();
  v_actor_name  TEXT;
  v_actor_email TEXT;
  v_actor_role  account_role_enum;
  v_from        TEXT;
  v_to          TEXT;
  v_contact     TEXT;
BEGIN
  IF NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
    RETURN NULL;
  END IF;
  IF NEW.account_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT full_name INTO v_from FROM profiles WHERE user_id = OLD.assigned_agent_id;
  SELECT full_name INTO v_to   FROM profiles WHERE user_id = NEW.assigned_agent_id;
  SELECT name      INTO v_contact FROM contacts WHERE id = NEW.contact_id;

  IF v_actor IS NOT NULL THEN
    SELECT full_name, email, account_role
      INTO v_actor_name, v_actor_email, v_actor_role
      FROM profiles
     WHERE user_id = v_actor;
  END IF;

  INSERT INTO account_activity_log (
    account_id, actor_user_id, actor_name, actor_email, actor_role,
    source, action, category, target_type, target_id, target_label,
    changes, metadata
  ) VALUES (
    NEW.account_id, v_actor, v_actor_name, v_actor_email, v_actor_role,
    CASE WHEN v_actor IS NULL THEN 'system' ELSE 'app' END,
    CASE WHEN NEW.assigned_agent_id IS NULL
         THEN 'inbox.conversation_unassigned'
         ELSE 'inbox.conversation_assigned' END,
    'inbox', 'conversation', NEW.id::text,
    NULLIF(v_contact, ''),
    jsonb_build_object(
      'assignee', jsonb_build_object(
        'from', COALESCE(v_from, '—'),
        'to',   COALESCE(v_to, '—')
      )
    ),
    jsonb_build_object('table', TG_TABLE_NAME, 'op', 'UPDATE')
  );

  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- 7. Triggers
--
-- One line per audited table. Adding a table = adding one block.
-- ------------------------------------------------------------
-- No DELETE trigger on `accounts` on purpose: the log row would
-- reference a tenant that is already gone (FK violation), and a row
-- about a deleted account would be cascaded away a moment later
-- anyway. Account deletion is a platform-admin action and lives in
-- `admin_audit_log`.
DROP TRIGGER IF EXISTS activity_accounts ON accounts;
CREATE TRIGGER activity_accounts
  AFTER INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'account.created', 'account.updated', 'account.updated',
    'settings', 'account', 'name', ''
  );

DROP TRIGGER IF EXISTS activity_whatsapp_config ON whatsapp_config;
CREATE TRIGGER activity_whatsapp_config
  AFTER INSERT OR UPDATE OR DELETE ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'settings.whatsapp_connected', 'settings.whatsapp_updated',
    'settings.whatsapp_disconnected',
    'settings', 'whatsapp', 'phone_number_id', ''
  );

DROP TRIGGER IF EXISTS activity_channel_configs ON channel_configs;
CREATE TRIGGER activity_channel_configs
  AFTER INSERT OR UPDATE OR DELETE ON channel_configs
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'integrations.channel_added', 'integrations.channel_updated',
    'integrations.channel_removed',
    'integrations', 'channel', 'display_name', 'access_token'
  );

DROP TRIGGER IF EXISTS activity_api_keys ON api_keys;
CREATE TRIGGER activity_api_keys
  AFTER INSERT OR UPDATE OR DELETE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'integrations.api_key_created', 'integrations.api_key_updated',
    'integrations.api_key_deleted',
    'integrations', 'api_key', 'name', 'key_hash'
  );

DROP TRIGGER IF EXISTS activity_webhook_endpoints ON webhook_endpoints;
CREATE TRIGGER activity_webhook_endpoints
  AFTER INSERT OR UPDATE OR DELETE ON webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'integrations.webhook_added', 'integrations.webhook_updated',
    'integrations.webhook_removed',
    'integrations', 'webhook', 'url', 'secret'
  );

DROP TRIGGER IF EXISTS activity_ai_configs ON ai_configs;
CREATE TRIGGER activity_ai_configs
  AFTER INSERT OR UPDATE OR DELETE ON ai_configs
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'settings.ai_enabled', 'settings.ai_updated', 'settings.ai_disabled',
    'settings', 'ai_config', 'provider', 'api_key,embeddings_api_key'
  );

DROP TRIGGER IF EXISTS activity_ai_knowledge ON ai_knowledge_documents;
CREATE TRIGGER activity_ai_knowledge
  AFTER INSERT OR UPDATE OR DELETE ON ai_knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'content.knowledge_added', 'content.knowledge_updated',
    'content.knowledge_removed',
    'content', 'knowledge', 'title', ''
  );

DROP TRIGGER IF EXISTS activity_templates ON message_templates;
CREATE TRIGGER activity_templates
  AFTER INSERT OR UPDATE OR DELETE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'content.template_added', 'content.template_updated',
    'content.template_removed',
    'content', 'template', 'name', ''
  );

DROP TRIGGER IF EXISTS activity_quick_replies ON quick_replies;
CREATE TRIGGER activity_quick_replies
  AFTER INSERT OR UPDATE OR DELETE ON quick_replies
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'content.quick_reply_added', 'content.quick_reply_updated',
    'content.quick_reply_removed',
    'content', 'quick_reply', 'title', ''
  );

DROP TRIGGER IF EXISTS activity_custom_fields ON custom_fields;
CREATE TRIGGER activity_custom_fields
  AFTER INSERT OR UPDATE OR DELETE ON custom_fields
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'settings.field_added', 'settings.field_updated', 'settings.field_removed',
    'settings', 'custom_field', 'field_name', ''
  );

DROP TRIGGER IF EXISTS activity_tags ON tags;
CREATE TRIGGER activity_tags
  AFTER INSERT OR UPDATE OR DELETE ON tags
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'settings.tag_added', 'settings.tag_updated', 'settings.tag_removed',
    'settings', 'tag', 'name', ''
  );

DROP TRIGGER IF EXISTS activity_pipelines ON pipelines;
CREATE TRIGGER activity_pipelines
  AFTER INSERT OR UPDATE OR DELETE ON pipelines
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'settings.pipeline_added', 'settings.pipeline_updated',
    'settings.pipeline_removed',
    'settings', 'pipeline', 'name', ''
  );

DROP TRIGGER IF EXISTS activity_automations ON automations;
CREATE TRIGGER activity_automations
  AFTER INSERT OR UPDATE OR DELETE ON automations
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'automations.automation_added', 'automations.automation_updated',
    'automations.automation_removed',
    'automations', 'automation', 'name', ''
  );

DROP TRIGGER IF EXISTS activity_flows ON flows;
CREATE TRIGGER activity_flows
  AFTER INSERT OR UPDATE OR DELETE ON flows
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'automations.flow_added', 'automations.flow_updated',
    'automations.flow_removed',
    'automations', 'flow', 'name', ''
  );

DROP TRIGGER IF EXISTS activity_invitations ON account_invitations;
CREATE TRIGGER activity_invitations
  AFTER INSERT OR UPDATE OR DELETE ON account_invitations
  FOR EACH ROW EXECUTE FUNCTION log_activity_row(
    'members.invited', 'members.invitation_updated', 'members.invitation_revoked',
    'members', 'invitation', 'label', 'token_hash'
  );

DROP TRIGGER IF EXISTS activity_profiles ON profiles;
CREATE TRIGGER activity_profiles
  AFTER INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION log_member_activity();

DROP TRIGGER IF EXISTS activity_conversations_assignment ON conversations;
CREATE TRIGGER activity_conversations_assignment
  AFTER UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION log_conversation_activity();

-- ------------------------------------------------------------
-- 8. Ownership — the trigger functions write past RLS, so they
-- must run as the table owner and must not be callable directly.
-- ------------------------------------------------------------
ALTER FUNCTION public.log_activity_row() OWNER TO postgres;
ALTER FUNCTION public.log_member_activity() OWNER TO postgres;
ALTER FUNCTION public.log_conversation_activity() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.log_activity_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_member_activity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_conversation_activity() FROM PUBLIC;

COMMENT ON TABLE account_activity_log IS
  'Append-only tenant audit trail: settings, integrations, content, members, assignments. Written only by triggers.';
