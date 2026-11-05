\set ON_ERROR_STOP on
BEGIN;
UPDATE notification_preferences SET customer_message = true, push_enabled = true;
DELETE FROM push_outbox;

INSERT INTO messages (conversation_id, sender_type, content_type, content_text, message_id, status)
VALUES ('d0000000-0000-0000-0000-0000000000c1','customer','text','عايز اعرف سعر الكشف','wamid.t1','delivered');
SELECT '1_unassigned' AS case, user_id IS NOT NULL AS has_user, kind, severity, contact_name FROM push_outbox;

INSERT INTO messages (conversation_id, sender_type, content_type, content_text, message_id, status)
VALUES ('dd90a41b-7a4c-4b19-b05e-f9315bbc8274','customer','text','thread2','wamid.t2','delivered');
SELECT '2_assigned' AS case, count(*) AS rows FROM push_outbox WHERE event_key LIKE 'msg:%:5b0ce6ed-d58f-42b1-8a8e-1dfa9aaa3403' AND event_key LIKE '%'||(SELECT id::text FROM messages WHERE message_id='wamid.t2')||'%';

-- one webhook: message + handoff notification in the same minute = 1 row, severity 3
DELETE FROM push_outbox;
INSERT INTO messages (conversation_id, sender_type, content_type, content_text, message_id, status)
VALUES ('d0000000-0000-0000-0000-0000000000c1','customer','text','محتاج مساعدة بشرية','wamid.t3','delivered');
INSERT INTO notifications (account_id,user_id,type,conversation_id,contact_id,title,body)
VALUES ('1c4f2d09-fe93-43cd-a284-bc1e8460f9da','5b0ce6ed-d58f-42b1-8a8e-1dfa9aaa3403','ai_handoff_unassigned',
        'd0000000-0000-0000-0000-0000000000c1','d0000000-0000-0000-0000-00000000000d','human needed','handoff');
SELECT '3_one_alert' AS case, count(*) AS rows, max(severity) AS sev, max(kind) AS kind FROM push_outbox;

-- preferences off -> nothing
DELETE FROM push_outbox;
UPDATE notification_preferences SET customer_message = false;
INSERT INTO messages (conversation_id, sender_type, content_type, content_text, message_id, status)
VALUES ('d0000000-0000-0000-0000-0000000000c1','customer','text','quiet','wamid.t4','delivered');
SELECT '4_pref_off' AS case, count(*) AS rows FROM push_outbox;
UPDATE notification_preferences SET customer_message = true;

-- reconciler: delete the row the trigger wrote, then backfill
DELETE FROM push_outbox;
INSERT INTO messages (conversation_id, sender_type, content_type, content_text, message_id, status)
VALUES ('d0000000-0000-0000-0000-0000000000c1','customer','text','lost','wamid.t5','delivered');
DELETE FROM push_outbox;
SELECT '5a_before' AS case, count(*) AS rows FROM push_outbox;
SELECT '5b_reconciled' AS case, public.reconcile_push_outbox() AS backfilled;
SELECT '5c_after' AS case, count(*) AS rows FROM push_outbox;
SELECT '5d_again' AS case, public.reconcile_push_outbox() AS backfilled;
ROLLBACK;
