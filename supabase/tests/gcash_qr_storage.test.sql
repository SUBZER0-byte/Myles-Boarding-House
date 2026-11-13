BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SELECT is(
    (SELECT "public" FROM storage.buckets WHERE "id" = 'mbh-payment-qrs'),
    false,
    'GCash QR images are stored in a private bucket'
);

SELECT ok(
    has_function_privilege('authenticated', 'public.manage_gcash_qrs(text,jsonb)', 'EXECUTE'),
    'authenticated users can call the role-checked GCash QR RPC'
);

SELECT ok(
    NOT has_function_privilege('anon', 'public.manage_gcash_qrs(text,jsonb)', 'EXECUTE'),
    'anonymous users cannot call the GCash QR RPC'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok(
    $$SELECT public.manage_gcash_qrs('admin_list', '{}'::jsonb)$$,
    'P0001',
    'An active authenticated account is required',
    'the GCash QR RPC rejects unauthenticated callers'
);

SELECT * FROM finish();
ROLLBACK;
