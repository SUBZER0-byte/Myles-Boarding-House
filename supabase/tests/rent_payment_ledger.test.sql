BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

CREATE TEMP TABLE rent_ledger_test_state (
    tenant_auth_id uuid NOT NULL,
    other_auth_id uuid NOT NULL,
    admin_auth_id uuid NOT NULL,
    tenant_id integer,
    other_tenant_id integer,
    payment_id integer,
    evidence_path text
);

INSERT INTO rent_ledger_test_state (tenant_auth_id, other_auth_id, admin_auth_id)
VALUES (
    'ffe30000-0000-4000-8000-000000000001',
    'ffe30000-0000-4000-8000-000000000002',
    'ffe30000-0000-4000-8000-000000000003'
);

INSERT INTO public."auth_otp_challenges" ("phone", "purpose", "email", "code_hash", "expires_at", "verified_at")
VALUES
    ('+639173000001', 'signup', 'rent-ledger-tenant@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP),
    ('+639173000002', 'signup', 'rent-ledger-other@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP),
    ('+639173000003', 'signup', 'rent-ledger-admin@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP);

INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    phone, raw_user_meta_data, created_at, updated_at
)
VALUES
    ('ffe30000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
     'rent-ledger-tenant@example.test', '', CURRENT_TIMESTAMP, '+639173000001',
     '{"username":"rent_ledger_tenant","full_name":"Rent Ledger Tenant","phone":"+639173000001}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ffe30000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
     'rent-ledger-other@example.test', '', CURRENT_TIMESTAMP, '+639173000002',
     '{"username":"rent_ledger_other","full_name":"Other Rent Ledger Tenant","phone":"+639173000002}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ffe30000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
     'rent-ledger-admin@example.test', '', CURRENT_TIMESTAMP, '+639173000003',
     '{"username":"rent_ledger_admin","full_name":"Rent Ledger Admin","phone":"+639173000003}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE public."users"
   SET "user_type" = 'Tenant'
 WHERE "auth_user_id" IN (
     'ffe30000-0000-4000-8000-000000000001',
     'ffe30000-0000-4000-8000-000000000002'
 );
UPDATE public."users"
   SET "user_type" = 'Admin'
 WHERE "auth_user_id" = 'ffe30000-0000-4000-8000-000000000003';

WITH tenant AS (
    INSERT INTO public."tenants" ("user_id", "full_name", "email", "move_in_date", "move_out_date", "is_active")
    SELECT u."user_id", u."full_name", u."email", CURRENT_DATE - 30, CURRENT_DATE + 60, 1
      FROM public."users" AS u
     WHERE u."auth_user_id" = 'ffe30000-0000-4000-8000-000000000001'
    RETURNING "tenant_id"
)
UPDATE rent_ledger_test_state SET tenant_id = (SELECT "tenant_id" FROM tenant);

WITH tenant AS (
    INSERT INTO public."tenants" ("user_id", "full_name", "email", "move_in_date", "move_out_date", "is_active")
    SELECT u."user_id", u."full_name", u."email", CURRENT_DATE - 30, CURRENT_DATE + 60, 1
      FROM public."users" AS u
     WHERE u."auth_user_id" = 'ffe30000-0000-4000-8000-000000000002'
    RETURNING "tenant_id"
)
UPDATE rent_ledger_test_state SET other_tenant_id = (SELECT "tenant_id" FROM tenant);

WITH payment AS (
    INSERT INTO public."payments" ("tenant_id", "amount", "due_date", "status", "description")
    VALUES ((SELECT tenant_id FROM rent_ledger_test_state), 1000, CURRENT_DATE, 'Pending', 'Rent installment')
    RETURNING "payment_id"
)
UPDATE rent_ledger_test_state SET payment_id = (SELECT "payment_id" FROM payment);
INSERT INTO public."gcash_qr_codes" ("filename", "amount")
VALUES ('gcash-qr/ffe30000-0000-4000-8000-000000000010.png', 1000);
INSERT INTO storage.objects ("bucket_id", "name")
VALUES ('mbh-payment-qrs', 'gcash-qr/ffe30000-0000-4000-8000-000000000010.png');

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok(
    $$SELECT public.manage_rent_ledger('tenant_history', '{}'::jsonb)$$,
    'P0001',
    'An active authenticated account is required',
    'unauthenticated rent history is rejected'
);

SELECT set_config('request.jwt.claim.sub', 'ffe30000-0000-4000-8000-000000000001', true);
SELECT is(
    jsonb_array_length(public.manage_rent_ledger('tenant_history', '{}'::jsonb)->'data'),
    1,
    'tenant history returns the authenticated tenant ledger'
);
SELECT throws_ok(
    $$SELECT public.manage_rent_ledger('admin_list', '{}'::jsonb)$$,
    'P0001',
    'Administrator access is required',
    'tenant cannot read Admin rent records'
);
SELECT throws_ok(
    $$SELECT public.manage_rent_ledger('tenant_submit', '{"payment_id":"bad"}'::jsonb)$$,
    'P0001',
    'A valid payment is required',
    'malformed rent payment submissions are rejected'
);

UPDATE rent_ledger_test_state
   SET evidence_path = tenant_auth_id::text || '/rent-payment/' || payment_id::text ||
                       '/ffe30000-0000-4000-8000-000000000020.png';
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES (
    'mbh-financial-evidence',
    (SELECT evidence_path FROM rent_ledger_test_state),
    '{"mimetype":"image/png","size":12}'::jsonb
);
SELECT is(
    public.manage_rent_ledger('tenant_submit', jsonb_build_object(
        'payment_id', (SELECT payment_id FROM rent_ledger_test_state),
        'reference', 'rent-ledger-reference',
        'screenshot_path', (SELECT evidence_path FROM rent_ledger_test_state)
    ))->>'type',
    'success',
    'tenant submits payment evidence through the owner-checked RPC'
);
SELECT is(
    (SELECT "status" FROM public."payments" WHERE "payment_id" = (SELECT payment_id FROM rent_ledger_test_state)),
    'Submitted',
    'rent submission and status update are committed together'
);
SELECT is(
    public.manage_rent_ledger('tenant_submit', jsonb_build_object(
        'payment_id', (SELECT payment_id FROM rent_ledger_test_state),
        'reference', 'rent-ledger-reference',
        'screenshot_path', (SELECT evidence_path FROM rent_ledger_test_state)
    ))->>'type',
    'success',
    'retrying the same proof submission is idempotent'
);

SELECT set_config('request.jwt.claim.sub', 'ffe30000-0000-4000-8000-000000000002', true);
SELECT is(
    jsonb_array_length(public.manage_rent_ledger('tenant_history', '{}'::jsonb)->'data'),
    0,
    'another tenant cannot read this tenant rent history'
);
SELECT throws_ok(
    $$SELECT public.manage_rent_ledger('tenant_submit', jsonb_build_object(
        'payment_id', (SELECT payment_id FROM rent_ledger_test_state),
        'reference', 'other-tenant-reference'
    ))$$,
    'P0001',
    'Payment not found or access denied',
    'another tenant cannot submit a payment for this ledger'
);

SELECT set_config('request.jwt.claim.sub', 'ffe30000-0000-4000-8000-000000000003', true);
SELECT is(
    jsonb_array_length(public.manage_rent_ledger('admin_list', jsonb_build_object(
        'tenant_id', (SELECT tenant_id FROM rent_ledger_test_state)
    ))->'data'),
    1,
    'Admin can list rent payments for a tenant'
);
SELECT is(
    public.manage_rent_ledger('admin_update_status', jsonb_build_object(
        'payment_id', (SELECT payment_id FROM rent_ledger_test_state),
        'status', 'Paid',
        'method', 'GCash',
        'reference', 'rent-ledger-reference'
    ))->>'type',
    'success',
    'Admin can record a submitted GCash payment as paid'
);
SELECT is(
    (SELECT "status" FROM public."payments" WHERE "payment_id" = (SELECT payment_id FROM rent_ledger_test_state)),
    'Paid',
    'Admin status decision is persisted'
);
SELECT is(
    public.manage_rent_ledger('admin_generate_next_month', '{}'::jsonb)->>'type',
    'success',
    'Admin next-month rent generation completes'
);

SELECT * FROM finish();
ROLLBACK;
