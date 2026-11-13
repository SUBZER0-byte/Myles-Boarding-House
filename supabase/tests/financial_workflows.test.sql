BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

CREATE TEMP TABLE financial_test_state (
    tenant_auth_id uuid NOT NULL,
    other_auth_id uuid NOT NULL,
    admin_auth_id uuid NOT NULL,
    room_id integer,
    tenant_id integer,
    other_tenant_id integer,
    paid_payment_id integer,
    full_request_id integer,
    refund_id integer,
    evidence_path text
);

INSERT INTO financial_test_state (tenant_auth_id, other_auth_id, admin_auth_id)
VALUES (
    'ffe20000-0000-4000-8000-000000000001',
    'ffe20000-0000-4000-8000-000000000002',
    'ffe20000-0000-4000-8000-000000000003'
);

INSERT INTO public."auth_otp_challenges" ("phone", "purpose", "email", "code_hash", "expires_at", "verified_at")
VALUES
    ('+639172000001', 'signup', 'financial-test-tenant@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP),
    ('+639172000002', 'signup', 'financial-test-other@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP),
    ('+639172000003', 'signup', 'financial-test-admin@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP);

INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    phone, raw_user_meta_data, created_at, updated_at
)
VALUES
    ('ffe20000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
     'financial-test-tenant@example.test', '', CURRENT_TIMESTAMP, '+639172000001',
     '{"username":"financial_test_tenant","full_name":"Financial Test Tenant","phone":"+639172000001}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ffe20000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
     'financial-test-other@example.test', '', CURRENT_TIMESTAMP, '+639172000002',
     '{"username":"financial_test_other","full_name":"Other Financial Tenant","phone":"+639172000002}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ffe20000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
     'financial-test-admin@example.test', '', CURRENT_TIMESTAMP, '+639172000003',
     '{"username":"financial_test_admin","full_name":"Financial Test Admin","phone":"+639172000003}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE public."users"
   SET "user_type" = 'Tenant'
 WHERE "auth_user_id" IN (
     'ffe20000-0000-4000-8000-000000000001',
     'ffe20000-0000-4000-8000-000000000002'
 );
UPDATE public."users"
   SET "user_type" = 'Admin'
 WHERE "auth_user_id" = 'ffe20000-0000-4000-8000-000000000003';

WITH room AS (
    INSERT INTO public."rooms" ("room_number", "room_type", "capacity", "monthly_rent", "status")
    VALUES ('financial-test-room', 'Single', 2, 1000, 'Occupied')
    RETURNING "room_id"
)
UPDATE financial_test_state SET room_id = (SELECT "room_id" FROM room);

WITH tenant AS (
    INSERT INTO public."tenants" ("user_id", "room_id", "full_name", "email", "move_in_date", "move_out_date", "is_active")
    SELECT u."user_id", s.room_id, u."full_name", u."email", CURRENT_DATE - 10, CURRENT_DATE + 90, 1
      FROM public."users" AS u
      CROSS JOIN financial_test_state AS s
     WHERE u."auth_user_id" = 'ffe20000-0000-4000-8000-000000000001'
    RETURNING "tenant_id"
)
UPDATE financial_test_state SET tenant_id = (SELECT "tenant_id" FROM tenant);

WITH tenant AS (
    INSERT INTO public."tenants" ("user_id", "room_id", "full_name", "email", "move_in_date", "move_out_date", "is_active")
    SELECT u."user_id", s.room_id, u."full_name", u."email", CURRENT_DATE - 10, CURRENT_DATE + 90, 1
      FROM public."users" AS u
      CROSS JOIN financial_test_state AS s
     WHERE u."auth_user_id" = 'ffe20000-0000-4000-8000-000000000002'
    RETURNING "tenant_id"
)
UPDATE financial_test_state SET other_tenant_id = (SELECT "tenant_id" FROM tenant);

WITH payment AS (
    INSERT INTO public."payments" ("tenant_id", "amount", "due_date", "status", "method", "reference_number", "description")
    VALUES ((SELECT tenant_id FROM financial_test_state), 1000, CURRENT_DATE, 'Paid', 'GCash', 'financial-paid-reference', 'Paid rent')
    RETURNING "payment_id"
)
UPDATE financial_test_state SET paid_payment_id = (SELECT "payment_id" FROM payment);

INSERT INTO public."payments" ("tenant_id", "amount", "due_date", "status", "payment_type", "description")
VALUES
    ((SELECT tenant_id FROM financial_test_state), 1000, CURRENT_DATE + 30, 'Pending', 'Pay Monthly', 'Rent installment 1'),
    ((SELECT tenant_id FROM financial_test_state), 1000, CURRENT_DATE + 60, 'Pending', 'Pay Monthly', 'Rent installment 2');

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok(
    $$SELECT public.manage_financial_workflows('refund_eligible', '{}'::jsonb)$$,
    'P0001',
    'An active authenticated account is required',
    'unauthenticated financial access is rejected'
);

SELECT set_config('request.jwt.claim.sub', 'ffe20000-0000-4000-8000-000000000001', true);
SELECT ok(
    (public.manage_financial_workflows('tenant_full_request', '{}'::jsonb)->>'type') = 'success',
    'tenant creates a full-payment snapshot'
);
UPDATE financial_test_state
   SET full_request_id = (
       SELECT max("request_id") FROM public."full_payment_requests"
        WHERE "tenant_id" = (SELECT tenant_id FROM financial_test_state)
   );
SELECT throws_ok(
    $$SELECT public.manage_financial_workflows('tenant_full_request', '{}'::jsonb)$$,
    'P0001',
    'You already have an open full payment request',
    'duplicate full-payment request cannot create a second active request'
);
SELECT is(
    (SELECT count(*)::integer FROM public."full_payment_requests"
      WHERE "tenant_id" = (SELECT tenant_id FROM financial_test_state)
        AND "status" IN ('Requested', 'Approved', 'Submitted')),
    1,
    'only one active full-payment request exists'
);
SELECT throws_ok(
    $$SELECT public.manage_financial_workflows('admin_full_list', '{}'::jsonb)$$,
    'P0001',
    'Administrator access is required',
    'tenant cannot read Admin full-payment records'
);

UPDATE financial_test_state
   SET evidence_path = tenant_auth_id::text || '/refund/' || paid_payment_id::text ||
                       '/ffe20000-0000-4000-8000-000000000020.png';
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES (
    'mbh-financial-evidence',
    (SELECT evidence_path FROM financial_test_state),
    '{"mimetype":"image/png","size":12}'::jsonb
);
CREATE TEMP TABLE financial_refund_result AS
SELECT public.manage_financial_workflows('refund_submit', jsonb_build_object(
    'payment_id', (SELECT paid_payment_id FROM financial_test_state),
    'gcash_account_name', 'Financial Test',
    'gcash_number', '09172000000',
    'transaction_reference', '',
    'reason', 'Test refund',
    'screenshot_path', (SELECT evidence_path FROM financial_test_state),
    'idempotency_key', 'ffe20000-0000-4000-8000-000000000020'
)) AS response;
UPDATE financial_test_state
   SET refund_id = (SELECT (response->'data'->>'refund_id')::integer FROM financial_refund_result);
SELECT ok(
    (SELECT response->>'type' = 'success' FROM financial_refund_result),
    'refund request and evidence link are committed together'
);
SELECT is(
    (public.manage_financial_workflows('refund_submit', jsonb_build_object(
        'payment_id', (SELECT paid_payment_id FROM financial_test_state),
        'gcash_account_name', 'Financial Test',
        'gcash_number', '09172000000',
        'transaction_reference', '',
        'reason', 'Test refund',
        'screenshot_path', (SELECT evidence_path FROM financial_test_state),
        'idempotency_key', 'ffe20000-0000-4000-8000-000000000020'
    ))->'data'->>'refund_id'),
    (SELECT refund_id::text FROM financial_test_state),
    'a retried refund submission returns its original request'
);
SELECT throws_ok(
    $$SELECT public.manage_financial_workflows('refund_submit', '{"payment_id":"bad"}'::jsonb)$$,
    'P0001',
    'A valid payment and request identifier are required',
    'malformed refund submissions are rejected'
);

SELECT set_config('request.jwt.claim.sub', 'ffe20000-0000-4000-8000-000000000002', true);
SELECT is(
    public.manage_financial_workflows('tenant_full_current', '{}'::jsonb)->'data',
    'null'::jsonb,
    'a different tenant cannot read another tenant full-payment request'
);
SELECT throws_ok(
    $$SELECT public.manage_financial_workflows('refund_submit', jsonb_build_object(
        'payment_id', (SELECT paid_payment_id FROM financial_test_state),
        'gcash_account_name', 'Other',
        'gcash_number', '09172000002',
        'idempotency_key', 'ffe20000-0000-4000-8000-000000000021'
    ))$$,
    'P0001',
    'Paid payment not found or refund period ended',
    'a different tenant cannot submit a refund for another tenant payment'
);
SELECT is(
    jsonb_array_length(public.manage_financial_workflows('refund_eligible', jsonb_build_object(
        'payment_id', (SELECT paid_payment_id FROM financial_test_state)
    ))->'data'),
    0,
    'a different tenant cannot enumerate another tenant payment as refundable'
);
SELECT set_config('financial_test.evidence_path', (SELECT evidence_path FROM financial_test_state), true);
SET LOCAL ROLE authenticated;
SELECT set_config(
    'financial_test.visible_count',
    (SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'mbh-financial-evidence'
        AND name = current_setting('financial_test.evidence_path')),
    true
);
RESET ROLE;
SELECT is(current_setting('financial_test.visible_count')::integer, 0,
          'private evidence is not visible to another tenant');

SELECT set_config('request.jwt.claim.sub', 'ffe20000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT set_config(
    'financial_test.visible_count',
    (SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'mbh-financial-evidence'
        AND name = current_setting('financial_test.evidence_path')),
    true
);
RESET ROLE;
SELECT is(current_setting('financial_test.visible_count')::integer, 1,
          'evidence owner can read private evidence');

SELECT set_config('request.jwt.claim.sub', 'ffe20000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT set_config(
    'financial_test.visible_count',
    (SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'mbh-financial-evidence'
        AND name = current_setting('financial_test.evidence_path')),
    true
);
RESET ROLE;
SELECT is(current_setting('financial_test.visible_count')::integer, 1,
          'Admin can read private financial evidence');
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES (
    'mbh-financial-evidence',
    'ffe20000-0000-4000-8000-000000000003/refund/999/ffe20000-0000-4000-8000-000000000099.png',
    '{"mimetype":"image/png","size":12}'::jsonb
);
SELECT set_config(
    'financial_test.orphan_path',
    'ffe20000-0000-4000-8000-000000000003/refund/999/ffe20000-0000-4000-8000-000000000099.png',
    true
);
SET LOCAL ROLE authenticated;
SELECT set_config(
    'financial_test.visible_count',
    (SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'mbh-financial-evidence'
        AND name = current_setting('financial_test.orphan_path')),
    true
);
RESET ROLE;
SELECT is(current_setting('financial_test.visible_count')::integer, 0,
          'Admin cannot read unlinked financial evidence');
SELECT is(
    jsonb_array_length(public.manage_financial_workflows('refund_admin_list', '{}'::jsonb)->'data'),
    1,
    'Admin can list refund requests'
);
SELECT throws_ok(
    $$SELECT public.manage_financial_workflows('admin_full_approve', jsonb_build_object(
        'request_id', (SELECT full_request_id FROM financial_test_state),
        'admin_note', '',
        'qr_path', 'ffe20000-0000-4000-8000-000000000003/full-payment-qr/' ||
                   (SELECT full_request_id FROM financial_test_state)::text ||
                   '/ffe20000-0000-4000-8000-000000000030.png'
    ))$$,
    'P0001',
    'GCash QR upload was not found',
    'approval without an uploaded QR is rejected transactionally'
);
SELECT is(
    (SELECT "status" FROM public."full_payment_requests"
      WHERE "request_id" = (SELECT full_request_id FROM financial_test_state)),
    'Requested',
    'failed full-payment approval leaves the request unchanged'
);
SELECT ok(
    (public.manage_financial_workflows('refund_decide', jsonb_build_object(
        'refund_id', (SELECT refund_id FROM financial_test_state),
        'decision', 'Approved',
        'admin_note', '',
        'transfer_reference', 'refund-transfer-001'
    ))->>'type') = 'success',
    'Admin can atomically approve a valid refund'
);
SELECT is(
    (SELECT "status" FROM public."refund_requests"
      WHERE "refund_id" = (SELECT refund_id FROM financial_test_state)),
    'Approved',
    'approved refund decision is persisted'
);

SELECT * FROM finish();
ROLLBACK;
