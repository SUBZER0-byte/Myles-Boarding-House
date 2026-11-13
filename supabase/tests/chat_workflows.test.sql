BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(21);

CREATE TEMP TABLE chat_test_state (
    admin_auth_id uuid NOT NULL,
    tenant_auth_id uuid NOT NULL,
    other_auth_id uuid NOT NULL,
    guest_auth_id uuid NOT NULL,
    admin_id integer,
    tenant_id integer,
    other_id integer,
    guest_id integer,
    first_message_id integer,
    image_message_id integer,
    image_path text
);

INSERT INTO chat_test_state (
    admin_auth_id, tenant_auth_id, other_auth_id, guest_auth_id
)
VALUES (
    'fce20000-0000-4000-8000-000000000001',
    'fce20000-0000-4000-8000-000000000002',
    'fce20000-0000-4000-8000-000000000003',
    'fce20000-0000-4000-8000-000000000004'
);

INSERT INTO public."auth_otp_challenges" ("phone", "purpose", "email", "code_hash", "expires_at", "verified_at")
VALUES
    ('+639172100001', 'signup', 'chat-test-admin@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP),
    ('+639172100002', 'signup', 'chat-test-tenant@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP),
    ('+639172100003', 'signup', 'chat-test-other@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP),
    ('+639172100004', 'signup', 'chat-test-guest@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP);

INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    phone, raw_user_meta_data, created_at, updated_at
)
VALUES
    ('fce20000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
     'chat-test-admin@example.test', '', CURRENT_TIMESTAMP, '+639172100001',
     '{"username":"chat_test_admin","full_name":"Chat Test Admin","phone":"+639172100001}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fce20000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
     'chat-test-tenant@example.test', '', CURRENT_TIMESTAMP, '+639172100002',
     '{"username":"chat_test_tenant","full_name":"Chat Test Tenant","phone":"+639172100002}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fce20000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
     'chat-test-other@example.test', '', CURRENT_TIMESTAMP, '+639172100003',
     '{"username":"chat_test_other","full_name":"Other Chat Tenant","phone":"+639172100003}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fce20000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
     'chat-test-guest@example.test', '', CURRENT_TIMESTAMP, '+639172100004',
     '{"username":"chat_test_guest","full_name":"Chat Test Guest","phone":"+639172100004}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE public."users"
   SET "user_type" = CASE
       WHEN "auth_user_id" = 'fce20000-0000-4000-8000-000000000001' THEN 'Admin'
       WHEN "auth_user_id" = 'fce20000-0000-4000-8000-000000000004' THEN 'Guest'
       ELSE 'Tenant'
   END
 WHERE "auth_user_id" IN (
     'fce20000-0000-4000-8000-000000000001',
     'fce20000-0000-4000-8000-000000000002',
     'fce20000-0000-4000-8000-000000000003',
     'fce20000-0000-4000-8000-000000000004'
 );

UPDATE chat_test_state
   SET admin_id = (SELECT "user_id" FROM public."users" WHERE "auth_user_id" = admin_auth_id),
       tenant_id = (SELECT "user_id" FROM public."users" WHERE "auth_user_id" = tenant_auth_id),
       other_id = (SELECT "user_id" FROM public."users" WHERE "auth_user_id" = other_auth_id),
       guest_id = (SELECT "user_id" FROM public."users" WHERE "auth_user_id" = guest_auth_id);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok(
    $$SELECT public.manage_my_chat('unread_count', '{}'::jsonb)$$,
    'P0001',
    'An active authenticated account is required',
    'unauthenticated chat access is rejected'
);

SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE chat_send_result AS
SELECT public.manage_my_chat('send', jsonb_build_object(
    'peer_id', (SELECT admin_id FROM chat_test_state),
    'body', 'Hello Admin',
    'image_paths', '[]'::jsonb
)) AS response;
UPDATE chat_test_state
   SET first_message_id = (SELECT (response->'data'->>'message_id')::integer FROM chat_send_result);
SELECT ok(
    (SELECT response->>'type' = 'success' FROM chat_send_result),
    'tenant can send a message'
);
SELECT is(
    (public.manage_my_chat('unread_count', '{}'::jsonb)->'data'->>'count')::integer,
    0,
    'sender does not count their own message as unread'
);

SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000001', true);
SELECT is(
    (public.manage_my_chat('unread_count', '{}'::jsonb)->'data'->>'count')::integer,
    1,
    'recipient sees one unread message'
);
SELECT is(
    jsonb_array_length(public.manage_my_chat('messages', jsonb_build_object(
        'peer_id', (SELECT tenant_id FROM chat_test_state)
    ))->'data'),
    1,
    'recipient can load their conversation'
);
SELECT is(
    (SELECT "is_read"::integer FROM public."chat_messages"
      WHERE "message_id" = (SELECT first_message_id FROM chat_test_state)),
    1,
    'opening a conversation marks incoming messages read'
);
SELECT is(
    (public.manage_my_chat('unread_count', '{}'::jsonb)->'data'->>'count')::integer,
    0,
    'reading the conversation clears the unread count'
);

SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000003', true);
SELECT is(
    jsonb_array_length(public.manage_my_chat('messages', jsonb_build_object(
        'peer_id', (SELECT admin_id FROM chat_test_state)
    ))->'data'),
    0,
    'an unrelated user cannot read another conversation'
);

SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000002', true);
SELECT ok(
    (public.manage_my_chat('remove', jsonb_build_object(
        'message_id', (SELECT first_message_id FROM chat_test_state),
        'mode', 'delete_for_me'
    ))->>'type') = 'success',
    'a participant can hide a message for themselves'
);
SELECT is(
    jsonb_array_length(public.manage_my_chat('messages', jsonb_build_object(
        'peer_id', (SELECT admin_id FROM chat_test_state)
    ))->'data'),
    0,
    'hidden message is omitted from the participant conversation'
);

SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000001', true);
SELECT is(
    jsonb_array_length(public.manage_my_chat('messages', jsonb_build_object(
        'peer_id', (SELECT tenant_id FROM chat_test_state)
    ))->'data'),
    1,
    'hiding a message does not remove it for the other participant'
);
SELECT ok(
    (public.manage_my_chat('send', jsonb_build_object(
        'peer_id', (SELECT tenant_id FROM chat_test_state),
        'body', 'Admin reply',
        'image_paths', '[]'::jsonb
    ))->>'type') = 'success',
    'Admin can reply to a tenant'
);

SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
    $$SELECT public.manage_my_chat('remove', jsonb_build_object(
        'message_id', (SELECT max("message_id") FROM public."chat_messages"),
        'mode', 'unsend'
    ))$$,
    'P0001',
    'You can only unsend your own messages',
    'a recipient cannot unsend another user message'
);

SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000004', true);
SELECT throws_ok(
    $$SELECT public.manage_my_chat('send', jsonb_build_object(
        'peer_id', (SELECT tenant_id FROM chat_test_state),
        'body', 'Guest message',
        'image_paths', '[]'::jsonb
    ))$$,
    'P0001',
    'Guests may contact Admin users only',
    'guest cannot message a tenant'
);
SELECT is(
    jsonb_array_length(public.manage_my_chat('conversations', '{}'::jsonb)->'data'),
    1,
    'guest conversation list includes only Admin users'
);

UPDATE chat_test_state
   SET image_path = tenant_auth_id::text || '/chat/fce20000-0000-4000-8000-000000000020.png';
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES (
    'mbh-chat-images',
    (SELECT image_path FROM chat_test_state),
    '{"mimetype":"image/png","size":12}'::jsonb
);
SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000002', true);
CREATE TEMP TABLE chat_image_result AS
SELECT public.manage_my_chat('send', jsonb_build_object(
    'peer_id', (SELECT admin_id FROM chat_test_state),
    'body', '',
    'image_paths', jsonb_build_array((SELECT image_path FROM chat_test_state))
)) AS response;
UPDATE chat_test_state
   SET image_message_id = (SELECT (response->'data'->>'message_id')::integer FROM chat_image_result);
SELECT ok(
    (SELECT response->>'type' = 'success' FROM chat_image_result),
    'chat image and message are linked'
);

SELECT set_config('financial_test.chat_image_path', (SELECT image_path FROM chat_test_state), true);
SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT set_config(
    'financial_test.visible_count',
    (SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'mbh-chat-images'
        AND name = current_setting('financial_test.chat_image_path')),
    true
);
RESET ROLE;
SELECT is(current_setting('financial_test.visible_count')::integer, 0,
          'nonparticipant cannot read chat attachments');

SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT set_config(
    'financial_test.visible_count',
    (SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'mbh-chat-images'
        AND name = current_setting('financial_test.chat_image_path')),
    true
);
RESET ROLE;
SELECT is(current_setting('financial_test.visible_count')::integer, 1,
          'message recipient can read private chat attachments');

SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000002', true);
SELECT ok(
    (public.manage_my_chat('remove', jsonb_build_object(
        'message_id', (SELECT image_message_id FROM chat_test_state),
        'mode', 'unsend'
    ))->>'type') = 'success',
    'sender can unsend their own message'
);
SELECT is(
    (SELECT "is_unsent"::integer FROM public."chat_messages"
      WHERE "message_id" = (SELECT image_message_id FROM chat_test_state)),
    1,
    'unsending removes message content'
);

SELECT set_config('request.jwt.claim.sub', 'fce20000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT set_config(
    'financial_test.visible_count',
    (SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'mbh-chat-images'
        AND name = current_setting('financial_test.chat_image_path')),
    true
);
RESET ROLE;
SELECT is(current_setting('financial_test.visible_count')::integer, 0,
          'unsent attachment is no longer readable');

SELECT * FROM finish();
ROLLBACK;
