BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(15);

INSERT INTO public."auth_otp_challenges" ("phone", "purpose", "email", "code_hash", "expires_at", "verified_at")
VALUES
    ('+639173000001', 'signup', 'admin-chatbot-test-admin@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP),
    ('+639173000002', 'signup', 'admin-chatbot-test-tenant@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP);

INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    phone, raw_user_meta_data, created_at, updated_at
)
VALUES
    ('ffe30000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
     'admin-chatbot-test-admin@example.test', '', CURRENT_TIMESTAMP, '+639173000001',
     '{"username":"admin_chatbot_test_admin","full_name":"Admin Chatbot Test"}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ffe30000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
     'admin-chatbot-test-tenant@example.test', '', CURRENT_TIMESTAMP, '+639173000002',
     '{"username":"admin_chatbot_test_tenant","full_name":"Tenant Chatbot Test"}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE public."users"
   SET "user_type" = 'Admin'
 WHERE "auth_user_id" = 'ffe30000-0000-4000-8000-000000000001';

SELECT ok(
    NOT has_function_privilege('anon', 'public.get_my_admin_chatbot_faqs()', 'EXECUTE'),
    'anonymous users cannot execute Admin FAQ RPCs'
);
SELECT ok(
    has_function_privilege('authenticated', 'public.get_my_admin_chatbot_faqs()', 'EXECUTE'),
    'authenticated users can invoke the role-checked Admin FAQ RPC'
);

SELECT set_config('request.jwt.claim.sub', 'ffe30000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
    $$SELECT public.get_my_admin_chatbot_faqs()$$,
    'P0001',
    'Administrator access is required',
    'Tenant cannot list Admin chatbot FAQs'
);
SELECT throws_ok(
    $$SELECT public.save_my_admin_chatbot_suggested_question(NULL, 'Unauthorized')$$,
    'P0001',
    'Administrator access is required',
    'Tenant cannot change chatbot suggested questions'
);

SELECT set_config('request.jwt.claim.sub', 'ffe30000-0000-4000-8000-000000000001', true);

SELECT ok(
    public.save_my_admin_chatbot_faq(NULL, 'rates', 'What is the rate?', 'The rate is listed on the room page.', true) > 0,
    'Admin can create an active FAQ'
);
SELECT ok(
    (SELECT count(*) = 1 FROM public.get_my_admin_chatbot_faqs()
      WHERE "question" = 'What is the rate?' AND "is_active" = 1),
    'Admin can read saved FAQs'
);
SELECT throws_ok(
    $$SELECT public.save_my_admin_chatbot_faq(NULL, 'unknown', 'Q', 'A', true)$$,
    'P0001',
    'Unsupported chatbot FAQ category',
    'invalid FAQ categories are rejected'
);
SELECT throws_ok(
    $$SELECT public.save_my_admin_chatbot_faq(NULL, 'rates', ' ', 'A', true)$$,
    'P0001',
    'Chatbot FAQ fields are invalid',
    'blank FAQ questions are rejected'
);

CREATE TEMP TABLE admin_chatbot_test_ids AS
SELECT
    (SELECT "faq_id" FROM public."chatbot_faqs" WHERE "question" = 'What is the rate?' LIMIT 1) AS faq_id,
    public.save_my_admin_chatbot_suggested_question(NULL, 'What should I bring?') AS suggested_id;

SELECT is(
    public.save_my_admin_chatbot_faq(
        (SELECT faq_id FROM admin_chatbot_test_ids), 'other', 'Updated question', 'Updated answer', false
    ),
    (SELECT faq_id FROM admin_chatbot_test_ids),
    'Admin can update an existing FAQ'
);
SELECT ok(
    EXISTS (
        SELECT 1 FROM public.get_my_admin_chatbot_faqs()
         WHERE "faq_id" = (SELECT faq_id FROM admin_chatbot_test_ids)
           AND "category" = 'other' AND "is_active" = 0
    ),
    'FAQ updates preserve category and active state'
);
SELECT is(
    (SELECT count(*) FROM public.get_my_admin_chatbot_suggested_questions()
      WHERE "question" = 'What should I bring?'),
    1::bigint,
    'Admin can list saved suggested questions'
);
SELECT is(
    public.save_my_admin_chatbot_suggested_question(
        (SELECT suggested_id FROM admin_chatbot_test_ids), 'Updated suggested question'
    ),
    (SELECT suggested_id FROM admin_chatbot_test_ids),
    'Admin can update an existing suggested question'
);
SELECT ok(
    EXISTS (
        SELECT 1 FROM public.get_my_admin_chatbot_suggested_questions()
         WHERE "suggested_question_id" = (SELECT suggested_id FROM admin_chatbot_test_ids)
           AND "question" = 'Updated suggested question'
    ),
    'suggested question update is visible to Admin'
);
SELECT lives_ok(
    $$SELECT public.delete_my_admin_chatbot_faq((SELECT faq_id FROM admin_chatbot_test_ids))$$,
    'Admin can delete an FAQ'
);
SELECT lives_ok(
    $$SELECT public.delete_my_admin_chatbot_suggested_question((SELECT suggested_id FROM admin_chatbot_test_ids))$$,
    'Admin can delete a suggested question'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
