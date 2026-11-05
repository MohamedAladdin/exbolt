-- Ownership (migration 108) behaviour, verified against the local stack.
-- Run: docker exec -i supabase_db_exbolt psql -U postgres -d postgres < supabase/tests/108_ownership.sql
-- Everything is inside one transaction and rolled back.
\set ON_ERROR_STOP on
BEGIN;

-- A second member so "never steal" is testable with a real profile row.
INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'mate@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (user_id, account_id, full_name, email, role, account_role)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '1c4f2d09-fe93-43cd-a284-bc1e8460f9da',
        'زميل', 'mate@test.local', 'agent', 'agent')
ON CONFLICT (user_id) DO UPDATE SET account_id = EXCLUDED.account_id;

SET LOCAL request.jwt.claims = '{"sub":"5b0ce6ed-d58f-42b1-8a8e-1dfa9aaa3403","role":"authenticated"}';
UPDATE conversations
   SET assigned_agent_id = NULL, claim_reason = NULL, first_opened_by = NULL, first_opened_at = NULL
 WHERE id = 'd0000000-0000-0000-0000-0000000000c1';
UPDATE accounts SET auto_claim_on_reply = true, auto_claim_on_open = false
 WHERE id = '1c4f2d09-fe93-43cd-a284-bc1e8460f9da';

-- 1) open with auto-claim off: first open recorded, still unassigned
SELECT claim_conversation('d0000000-0000-0000-0000-0000000000c1', 'open');
SELECT '1_open_off' AS case,
       assigned_agent_id IS NULL AS unassigned,
       first_opened_by IS NOT NULL AS first_open_recorded
  FROM conversations WHERE id = 'd0000000-0000-0000-0000-0000000000c1';

-- 2) reply claims it
SELECT claim_conversation('d0000000-0000-0000-0000-0000000000c1', 'reply');
SELECT '2_reply_claims' AS case,
       assigned_agent_id = '5b0ce6ed-d58f-42b1-8a8e-1dfa9aaa3403' AS mine,
       claim_reason
  FROM conversations WHERE id = 'd0000000-0000-0000-0000-0000000000c1';

-- 3) never steal from a colleague
UPDATE conversations
   SET assigned_agent_id = 'aaaaaaaa-0000-0000-0000-000000000001'
 WHERE id = 'd0000000-0000-0000-0000-0000000000c1';
SELECT claim_conversation('d0000000-0000-0000-0000-0000000000c1', 'reply');
SELECT '3_no_steal' AS case,
       assigned_agent_id = 'aaaaaaaa-0000-0000-0000-000000000001' AS still_theirs
  FROM conversations WHERE id = 'd0000000-0000-0000-0000-0000000000c1';

-- 4) auto-claim on open, when the account asks for it
UPDATE conversations SET assigned_agent_id = NULL
 WHERE id = 'd0000000-0000-0000-0000-0000000000c1';
UPDATE accounts SET auto_claim_on_open = true
 WHERE id = '1c4f2d09-fe93-43cd-a284-bc1e8460f9da';
SELECT claim_conversation('d0000000-0000-0000-0000-0000000000c1', 'open');
SELECT '4_open_claims' AS case, claim_reason
  FROM conversations WHERE id = 'd0000000-0000-0000-0000-0000000000c1';

-- 5) a user from another account cannot claim
SET LOCAL request.jwt.claims = '{"sub":"03da4e10-530e-40a3-a440-3809c206e9a2","role":"authenticated"}';
UPDATE conversations SET assigned_agent_id = NULL
 WHERE id = 'd0000000-0000-0000-0000-0000000000c1';
SELECT claim_conversation('d0000000-0000-0000-0000-0000000000c1', 'reply');
SELECT '5_foreigner' AS case, assigned_agent_id IS NULL AS untouched
  FROM conversations WHERE id = 'd0000000-0000-0000-0000-0000000000c1';

ROLLBACK;
