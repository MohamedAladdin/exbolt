-- ============================================================
-- Local verification matrix for migration 070.
--
-- Exercises every audited table, the masking rules, the no-op
-- suppression, the actor attribution, the RLS gate and — the case that
-- bit us — deleting a whole account while children cascade.
--
-- Everything runs in ONE transaction that is rolled back, so the dev
-- database is left exactly as it was. Run it with:
--   docker exec -i supabase_db_exbolt psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f /tmp/070_matrix.sql
-- ============================================================
\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE _t (name text, ok boolean);
CREATE OR REPLACE FUNCTION pg_temp.check(p_name text, p_ok boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _t VALUES (p_name, coalesce(p_ok, false));
END $$;

CREATE OR REPLACE FUNCTION pg_temp.last_event(p_account uuid)
RETURNS account_activity_log LANGUAGE sql AS $$
  SELECT * FROM account_activity_log
   WHERE account_id = p_account ORDER BY id DESC LIMIT 1
$$;

\set ACC '''1c4f2d09-fe93-43cd-a284-bc1e8460f9da'''
\set UID '''5b0ce6ed-d58f-42b1-8a8e-1dfa9aaa3403'''
\set AGENT '''9c702f07-0d4c-4be3-8bc9-6db697cd2f23'''

SET request.jwt.claims = '{"sub":"5b0ce6ed-d58f-42b1-8a8e-1dfa9aaa3403","role":"authenticated"}';
SELECT set_config('t.start_id', (SELECT coalesce(max(id),0)::text FROM account_activity_log), false);

-- ------------------------------------------------------------
-- 1. settings — multi-field diff
-- ------------------------------------------------------------
UPDATE whatsapp_config
   SET mirror_inbound_media = NOT mirror_inbound_media,
       is_default = is_default
 WHERE account_id = :ACC;
SELECT pg_temp.check(
  'whatsapp: one row per statement',
  (SELECT count(*) = 1 FROM account_activity_log WHERE id > current_setting('t.start_id')::bigint)
);
SELECT pg_temp.check(
  'whatsapp: action + category',
  (SELECT (e.action = 'settings.whatsapp_updated' AND e.category = 'settings')
     FROM pg_temp.last_event(:ACC) e)
);
SELECT pg_temp.check(
  'whatsapp: actor snapshot (name/email/role)',
  (SELECT e.actor_user_id = :UID AND e.actor_role = 'owner'
          AND e.actor_email IS NOT NULL AND e.source = 'app'
     FROM pg_temp.last_event(:ACC) e)
);
SELECT pg_temp.check(
  'whatsapp: diff names the changed column only',
  (SELECT e.changes ? 'mirror_inbound_media'
          AND NOT (e.changes ? 'is_default')
     FROM pg_temp.last_event(:ACC) e)
);
SELECT pg_temp.check(
  'whatsapp: target label is the phone number',
  (SELECT e.target_label IS NOT NULL AND e.target_type = 'whatsapp'
     FROM pg_temp.last_event(:ACC) e)
);

-- ------------------------------------------------------------
-- 2. secrets are masked, never stored
-- ------------------------------------------------------------
UPDATE whatsapp_config SET access_token = 'EAAG-ULTRA-SECRET-TOKEN-VALUE'
 WHERE account_id = :ACC;
SELECT pg_temp.check(
  'secrets: access_token masked as •••',
  (SELECT e.changes -> 'access_token' ->> 'to' = '•••'
          AND e.changes -> 'access_token' ->> 'from' = '•••'
     FROM pg_temp.last_event(:ACC) e)
);
SELECT pg_temp.check(
  'secrets: raw token appears in no column of the log',
  NOT EXISTS (
    SELECT 1 FROM account_activity_log
     WHERE id > current_setting('t.start_id')::bigint
       AND (changes::text || coalesce(target_label,'') || metadata::text) LIKE '%ULTRA-SECRET%'
  )
);

UPDATE whatsapp_config SET verify_token = 'VERIFY-SECRET-2' WHERE account_id = :ACC;
SELECT pg_temp.check(
  'secrets: verify_token masked too',
  (SELECT e.changes -> 'verify_token' ->> 'to' = '•••' FROM pg_temp.last_event(:ACC) e)
);

-- ------------------------------------------------------------
-- 3. no-op updates write nothing
-- ------------------------------------------------------------
SELECT set_config('t.before', (SELECT max(id)::text FROM account_activity_log), false);
UPDATE whatsapp_config SET updated_at = NOW() WHERE account_id = :ACC;
UPDATE profiles SET avatar_url = NULL, full_name = full_name WHERE user_id = :UID;
SELECT pg_temp.check(
  'no-op: bookkeeping-only writes are not logged',
  (SELECT max(id) = current_setting('t.before')::bigint FROM account_activity_log)
);

-- ------------------------------------------------------------
-- 4. content + settings tables: insert / update / delete each
-- ------------------------------------------------------------
INSERT INTO tags (account_id, user_id, name, color)
VALUES (:ACC, :UID, 'm-tag', '#111111');
SELECT pg_temp.check('tags: insert action', (SELECT (e.action = 'settings.tag_added') FROM pg_temp.last_event(:ACC) e));

UPDATE tags SET color = '#222222' WHERE account_id = :ACC AND name = 'm-tag';
SELECT pg_temp.check(
  'tags: update diff',
  (SELECT e.action = 'settings.tag_updated' AND e.changes -> 'color' ->> 'to' = '#222222'
     FROM pg_temp.last_event(:ACC) e)
);

DELETE FROM tags WHERE account_id = :ACC AND name = 'm-tag';
SELECT pg_temp.check('tags: delete action', (SELECT (e.action = 'settings.tag_removed') FROM pg_temp.last_event(:ACC) e));

INSERT INTO custom_fields (account_id, user_id, field_name, field_type)
VALUES (:ACC, :UID, 'm_field', 'text');
SELECT pg_temp.check('custom_fields: insert', (SELECT (e.action = 'settings.field_added') FROM pg_temp.last_event(:ACC) e));
UPDATE custom_fields SET field_type = 'number' WHERE account_id = :ACC AND field_name = 'm_field';
SELECT pg_temp.check('custom_fields: update', (SELECT (e.action = 'settings.field_updated') FROM pg_temp.last_event(:ACC) e));
DELETE FROM custom_fields WHERE account_id = :ACC AND field_name = 'm_field';
SELECT pg_temp.check('custom_fields: delete', (SELECT (e.action = 'settings.field_removed') FROM pg_temp.last_event(:ACC) e));

INSERT INTO pipelines (account_id, user_id, name) VALUES (:ACC, :UID, 'm-pipeline');
SELECT pg_temp.check('pipelines: insert', (SELECT (e.action = 'settings.pipeline_added') FROM pg_temp.last_event(:ACC) e));
DELETE FROM pipelines WHERE account_id = :ACC AND name = 'm-pipeline';
SELECT pg_temp.check('pipelines: delete', (SELECT (e.action = 'settings.pipeline_removed') FROM pg_temp.last_event(:ACC) e));

INSERT INTO quick_replies (account_id, user_id, title, kind, content_text)
VALUES (:ACC, :UID, 'm-reply', 'text', 'hi');
SELECT pg_temp.check('quick_replies: insert', (SELECT (e.action = 'content.quick_reply_added') FROM pg_temp.last_event(:ACC) e));
DELETE FROM quick_replies WHERE account_id = :ACC AND title = 'm-reply';
SELECT pg_temp.check('quick_replies: delete', (SELECT (e.action = 'content.quick_reply_removed') FROM pg_temp.last_event(:ACC) e));

INSERT INTO message_templates (account_id, user_id, name, category, body_text)
VALUES (:ACC, :UID, 'm-template', 'Marketing', 'hello');
SELECT pg_temp.check('templates: insert', (SELECT (e.action = 'content.template_added') FROM pg_temp.last_event(:ACC) e));
DELETE FROM message_templates WHERE account_id = :ACC AND name = 'm-template';
SELECT pg_temp.check('templates: delete', (SELECT (e.action = 'content.template_removed') FROM pg_temp.last_event(:ACC) e));

INSERT INTO automations (account_id, user_id, name, trigger_type, trigger_config, is_active)
VALUES (:ACC, :UID, 'm-auto', 'keyword', '{"keywords":["x"]}'::jsonb, true);
SELECT pg_temp.check('automations: insert', (SELECT (e.action = 'automations.automation_added') FROM pg_temp.last_event(:ACC) e));
UPDATE automations SET is_active = false WHERE account_id = :ACC AND name = 'm-auto';
SELECT pg_temp.check(
  'automations: update diff',
  (SELECT e.action = 'automations.automation_updated' AND e.changes -> 'is_active' ->> 'to' = 'false'
     FROM pg_temp.last_event(:ACC) e)
);
DELETE FROM automations WHERE account_id = :ACC AND name = 'm-auto';
SELECT pg_temp.check('automations: delete', (SELECT (e.action = 'automations.automation_removed') FROM pg_temp.last_event(:ACC) e));

INSERT INTO flows (account_id, user_id, name, status, trigger_type, trigger_config)
VALUES (:ACC, :UID, 'm-flow', 'draft', 'keyword', '{}'::jsonb);
SELECT pg_temp.check('flows: insert', (SELECT (e.action = 'automations.flow_added') FROM pg_temp.last_event(:ACC) e));
DELETE FROM flows WHERE account_id = :ACC AND name = 'm-flow';
SELECT pg_temp.check('flows: delete', (SELECT (e.action = 'automations.flow_removed') FROM pg_temp.last_event(:ACC) e));

INSERT INTO api_keys (account_id, created_by, name, key_prefix, key_hash, scopes)
VALUES (:ACC, :UID, 'm-key', 'exbolt_live_ab', 'DEADBEEFHASHVALUE', ARRAY['contacts:read']);
SELECT pg_temp.check('api_keys: insert', (SELECT (e.action = 'integrations.api_key_created') FROM pg_temp.last_event(:ACC) e));
UPDATE api_keys SET revoked_at = NOW() WHERE account_id = :ACC AND name = 'm-key';
SELECT pg_temp.check(
  'api_keys: revoke diff, hash never leaked',
  (SELECT e.action = 'integrations.api_key_updated'
          AND NOT (e.changes ? 'key_hash')
          AND e.changes::text NOT LIKE '%DEADBEEF%'
     FROM pg_temp.last_event(:ACC) e)
);
DELETE FROM api_keys WHERE account_id = :ACC AND name = 'm-key';
SELECT pg_temp.check('api_keys: delete', (SELECT (e.action = 'integrations.api_key_deleted') FROM pg_temp.last_event(:ACC) e));

INSERT INTO webhook_endpoints (account_id, created_by, url, secret, events, is_active)
VALUES (:ACC, :UID, 'https://example.test/hook', 'WH-SECRET', ARRAY['message.received'], true);
SELECT pg_temp.check('webhooks: insert', (SELECT (e.action = 'integrations.webhook_added') FROM pg_temp.last_event(:ACC) e));
UPDATE webhook_endpoints SET secret = 'WH-SECRET-2' WHERE account_id = :ACC AND url = 'https://example.test/hook';
SELECT pg_temp.check(
  'webhooks: secret masked',
  (SELECT e.changes -> 'secret' ->> 'to' = '•••' FROM pg_temp.last_event(:ACC) e)
);
DELETE FROM webhook_endpoints WHERE account_id = :ACC AND url = 'https://example.test/hook';
SELECT pg_temp.check('webhooks: delete', (SELECT (e.action = 'integrations.webhook_removed') FROM pg_temp.last_event(:ACC) e));

INSERT INTO channel_configs (account_id, channel, external_id, display_name, access_token, is_active)
VALUES (:ACC, 'instagram', 'ig-1', 'm-channel', 'IG-TOKEN', true);
SELECT pg_temp.check('channels: insert', (SELECT (e.action = 'integrations.channel_added') FROM pg_temp.last_event(:ACC) e));
UPDATE channel_configs SET access_token = 'IG-TOKEN-2'
 WHERE account_id = :ACC AND external_id = 'ig-1';
SELECT pg_temp.check(
  'channels: token masked',
  (SELECT e.changes -> 'access_token' ->> 'to' = '•••' FROM pg_temp.last_event(:ACC) e)
);
DELETE FROM channel_configs WHERE account_id = :ACC AND external_id = 'ig-1';
SELECT pg_temp.check('channels: delete', (SELECT (e.action = 'integrations.channel_removed') FROM pg_temp.last_event(:ACC) e));

-- ------------------------------------------------------------
-- 5. AI: long text is clipped, keys are masked
-- ------------------------------------------------------------
INSERT INTO ai_knowledge_documents (account_id, created_by, title, content)
VALUES (:ACC, :UID, 'm-doc', repeat('ط', 400));
SELECT pg_temp.check('knowledge: insert', (SELECT (e.action = 'content.knowledge_added') FROM pg_temp.last_event(:ACC) e));
UPDATE ai_knowledge_documents SET content = repeat('ب', 400) WHERE account_id = :ACC AND title = 'm-doc';
SELECT pg_temp.check(
  'knowledge: long body clipped to 280 + …',
  (SELECT length(e.changes -> 'content' ->> 'to') <= 280
          AND e.changes -> 'content' ->> 'to' LIKE '%…'
     FROM pg_temp.last_event(:ACC) e)
);
DELETE FROM ai_knowledge_documents WHERE account_id = :ACC AND title = 'm-doc';
SELECT pg_temp.check('knowledge: delete', (SELECT (e.action = 'content.knowledge_removed') FROM pg_temp.last_event(:ACC) e));

INSERT INTO ai_configs (account_id, created_by, provider, model, api_key, system_prompt)
VALUES (:ACC, :UID, 'openai', 'gpt-4o-mini', 'SK-SECRET-KEY', 'prompt')
ON CONFLICT DO NOTHING;
UPDATE ai_configs SET api_key = 'SK-SECRET-KEY-2' WHERE account_id = :ACC;
SELECT pg_temp.check(
  'ai: provider key masked',
  (SELECT e.changes -> 'api_key' ->> 'to' = '•••' FROM pg_temp.last_event(:ACC) e)
);
DELETE FROM ai_configs WHERE account_id = :ACC AND api_key LIKE 'SK-%';

-- ------------------------------------------------------------
-- 6. members: role change, removal, invitations
-- ------------------------------------------------------------
UPDATE profiles SET account_role = 'agent' WHERE user_id = :UID;
SELECT pg_temp.check(
  'members: role change diff (owner → agent)',
  (SELECT e.action = 'members.role_changed'
          AND e.changes -> 'account_role' ->> 'from' = 'owner'
          AND e.changes -> 'account_role' ->> 'to' = 'agent'
          AND e.category = 'members'
     FROM pg_temp.last_event(:ACC) e)
);
UPDATE profiles SET account_role = 'owner' WHERE user_id = :UID;

INSERT INTO account_invitations (account_id, token_hash, role, created_by_user_id, label, expires_at)
VALUES (:ACC, 'm-token-hash', 'agent', :UID, 'm-invite@example.test', NOW() + INTERVAL '1 day');
SELECT pg_temp.check('invitations: insert', (SELECT (e.action = 'members.invited') FROM pg_temp.last_event(:ACC) e));
UPDATE account_invitations SET accepted_at = NOW() WHERE account_id = :ACC AND label = 'm-invite@example.test';
SELECT pg_temp.check(
  'invitations: accept diff, token hash never stored',
  (SELECT e.action = 'members.invitation_updated'
          AND NOT (e.changes ? 'token_hash')
          AND e.changes::text NOT LIKE '%m-token-hash%'
     FROM pg_temp.last_event(:ACC) e)
);
DELETE FROM account_invitations WHERE account_id = :ACC AND label = 'm-invite@example.test';
SELECT pg_temp.check('invitations: delete', (SELECT (e.action = 'members.invitation_revoked') FROM pg_temp.last_event(:ACC) e));

-- ------------------------------------------------------------
-- 7. inbox assignment
-- ------------------------------------------------------------
SELECT set_config('m.conv',
  (SELECT id::text FROM conversations WHERE account_id = :ACC ORDER BY id LIMIT 1), true);
UPDATE conversations SET assigned_agent_id = :UID
 WHERE id = current_setting('m.conv')::uuid;
SELECT pg_temp.check(
  'inbox: assignment resolved to names, not uuids',
  (SELECT e.action = 'inbox.conversation_assigned'
          AND e.changes -> 'assignee' ->> 'to' = (SELECT full_name FROM profiles WHERE user_id = :UID)
          AND e.changes -> 'assignee' ->> 'from' = '—'
     FROM pg_temp.last_event(:ACC) e)
);
UPDATE conversations SET assigned_agent_id = NULL
 WHERE id = current_setting('m.conv')::uuid;
SELECT pg_temp.check(
  'inbox: unassign action',
  (SELECT (e.action = 'inbox.conversation_unassigned') FROM pg_temp.last_event(:ACC) e)
);

-- ------------------------------------------------------------
-- 8. system writes (no JWT) are attributed to `system`
-- ------------------------------------------------------------
RESET request.jwt.claims;
UPDATE tags SET color = '#333333' WHERE account_id = :ACC AND id IS NOT NULL
  AND id = (SELECT id FROM tags WHERE account_id = :ACC LIMIT 1);
SELECT pg_temp.check(
  'system: source=system, no actor',
  (SELECT e.source = 'system' AND e.actor_user_id IS NULL FROM pg_temp.last_event(:ACC) e)
);
SET request.jwt.claims = '{"sub":"5b0ce6ed-d58f-42b1-8a8e-1dfa9aaa3403","role":"authenticated"}';

-- ------------------------------------------------------------
-- 9. account rename + create
-- ------------------------------------------------------------
UPDATE accounts SET name = name || ' (m)' WHERE id = :ACC;
SELECT pg_temp.check(
  'account: rename diff',
  (SELECT e.action = 'account.updated' AND e.changes ? 'name' FROM pg_temp.last_event(:ACC) e)
);
UPDATE accounts SET name = replace(name, ' (m)', '') WHERE id = :ACC;

-- ------------------------------------------------------------
-- 10. RLS gate
-- ------------------------------------------------------------
-- Role switches cannot touch the TEMP results table, so each count is
-- captured into a GUC while the role is active and asserted afterwards.
SET LOCAL ROLE authenticated;
SELECT set_config('t.owner_sees',
  (SELECT count(*)::text FROM account_activity_log WHERE account_id = :ACC), true);
RESET ROLE;
SELECT pg_temp.check('rls: owner reads own trail', current_setting('t.owner_sees')::int > 0);

UPDATE profiles SET account_role = 'agent' WHERE user_id = :UID;
SET LOCAL ROLE authenticated;
SELECT set_config('t.agent_sees',
  (SELECT count(*)::text FROM account_activity_log WHERE account_id = :ACC), true);
RESET ROLE;
SELECT pg_temp.check('rls: agent sees nothing', current_setting('t.agent_sees')::int = 0);
UPDATE profiles SET account_role = 'owner' WHERE user_id = :UID;

SET LOCAL request.jwt.claims = '{"sub":"9c702f07-0d4c-4be3-8bc9-6db697cd2f23","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT set_config('t.foreign_sees',
  (SELECT count(*)::text FROM account_activity_log WHERE account_id = :ACC), true);
RESET ROLE;
SELECT pg_temp.check('rls: another account sees nothing', current_setting('t.foreign_sees')::int = 0);
SET LOCAL request.jwt.claims = '{"sub":"5b0ce6ed-d58f-42b1-8a8e-1dfa9aaa3403","role":"authenticated"}';

SELECT pg_temp.check(
  'rls: no write policy exists on the log',
  (SELECT count(*) = 0 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_activity_log'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
);

-- ------------------------------------------------------------
-- 11. deleting a whole account must not be blocked by the triggers
-- ------------------------------------------------------------
-- A throwaway auth user gives us a real account with a real profile
-- (the signup trigger creates both), which is the shape a production
-- delete actually meets.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'bbbb1111-2222-3333-4444-555555555555',
  'authenticated', 'authenticated', 'm-delete-me@example.test',
  crypt('x', gen_salt('bf')), NOW(), NOW(), NOW(), '{}'::jsonb, '{}'::jsonb
);
SELECT set_config('m.doomed_account',
  (SELECT account_id::text FROM profiles WHERE user_id = 'bbbb1111-2222-3333-4444-555555555555'), true);
INSERT INTO tags (account_id, user_id, name, color)
VALUES (current_setting('m.doomed_account')::uuid, :UID, 'doomed', '#000000');
INSERT INTO pipelines (account_id, user_id, name)
VALUES (current_setting('m.doomed_account')::uuid, :UID, 'doomed');
SELECT pg_temp.check(
  'delete: log rows exist before the account goes',
  (SELECT count(*) > 0 FROM account_activity_log
    WHERE account_id = current_setting('m.doomed_account')::uuid)
);
SELECT pg_temp.check(
  'delete: joining produced a members.joined event',
  (SELECT count(*) = 1 FROM account_activity_log
    WHERE account_id = current_setting('m.doomed_account')::uuid
      AND action = 'members.joined')
);
DELETE FROM accounts WHERE id = current_setting('m.doomed_account')::uuid;
SELECT pg_temp.check(
  'delete: account removed and its trail cascaded away',
  (SELECT count(*) = 0 FROM account_activity_log
    WHERE account_id = current_setting('m.doomed_account')::uuid)
);

-- ------------------------------------------------------------
-- Results
-- ------------------------------------------------------------
\echo ''
\echo '=== matrix ==='
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM _t ORDER BY name;
\echo ''
SELECT count(*) FILTER (WHERE ok) AS passed,
       count(*) FILTER (WHERE NOT ok) AS failed,
       count(*) AS total
  FROM _t;

ROLLBACK;
