BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(25);

CREATE TEMP TABLE guest_booking_test_state (
    guest_auth_id uuid NOT NULL,
    other_guest_auth_id uuid NOT NULL,
    admin_auth_id uuid NOT NULL,
    room_id integer,
    booking_id integer
);

INSERT INTO guest_booking_test_state (guest_auth_id, other_guest_auth_id, admin_auth_id)
VALUES (
    'ffe10000-0000-4000-8000-000000000001',
    'ffe10000-0000-4000-8000-000000000002',
    'ffe10000-0000-4000-8000-000000000003'
);

INSERT INTO public."auth_otp_challenges" ("phone", "purpose", "email", "code_hash", "expires_at", "verified_at")
VALUES
    ('+639171000001', 'signup', 'booking-test-guest@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP),
    ('+639171000002', 'signup', 'booking-test-other@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP),
    ('+639171000003', 'signup', 'booking-test-admin@example.test', 'test', CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP);

INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    phone, raw_user_meta_data, created_at, updated_at
)
VALUES
    ('ffe10000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
     'booking-test-guest@example.test', '', CURRENT_TIMESTAMP, '+639171000001',
     '{"username":"booking_test_guest","full_name":"Booking Test Guest","phone":"+639171000001}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ffe10000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
     'booking-test-other@example.test', '', CURRENT_TIMESTAMP, '+639171000002',
     '{"username":"booking_test_other","full_name":"Other Booking Guest","phone":"+639171000002}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ffe10000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
     'booking-test-admin@example.test', '', CURRENT_TIMESTAMP, '+639171000003',
     '{"username":"booking_test_admin","full_name":"Booking Test Admin","phone":"+639171000003}'::jsonb,
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE public."users"
   SET "user_type" = 'Admin'
 WHERE "auth_user_id" = 'ffe10000-0000-4000-8000-000000000003';

WITH inserted_room AS (
    INSERT INTO public."rooms" ("room_number", "room_type", "capacity", "monthly_rent", "status")
    VALUES ('booking-test-room', 'Single', 1, 1000, 'Available')
    RETURNING "room_id"
)
UPDATE guest_booking_test_state SET room_id = (SELECT "room_id" FROM inserted_room);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT ok(public.current_app_user_role() IS NULL, 'missing JWT has no application identity');
SELECT throws_ok(
    $$SELECT public.manage_guest_booking('guest_list', '{}'::jsonb)$$,
    'P0001',
    'An active authenticated account is required',
    'unauthenticated guest booking access is rejected'
);

SELECT set_config('request.jwt.claim.sub', (SELECT guest_auth_id::text FROM guest_booking_test_state), true);
SELECT ok(public.current_app_user_role() = 'Guest', 'test guest identity resolves from the verified JWT');
SELECT throws_ok(
    $$SELECT public.manage_guest_booking('admin_list', '{}'::jsonb)$$,
    'P0001',
    'Administrator access is required',
    'guest cannot list Admin bookings'
);

SELECT ok(
    (public.manage_guest_booking('acquire_hold', jsonb_build_object(
        'room_id', (SELECT room_id FROM guest_booking_test_state),
        'move_in_date', (CURRENT_DATE + 30)::text,
        'check_out_date', (CURRENT_DATE + 90)::text
    ))->>'type') = 'success',
    'guest can acquire an expiring hold for available capacity'
);

CREATE TEMP TABLE guest_booking_test_response AS
SELECT public.manage_guest_booking('create', jsonb_build_object(
    'room_id', (SELECT room_id FROM guest_booking_test_state),
    'full_name', 'Booking Test Guest',
    'phone', '09171000001',
    'move_in_date', (CURRENT_DATE + 30)::text,
    'check_out_date', (CURRENT_DATE + 90)::text,
    'payment_plan', 'Pay Monthly',
    'idempotency_key', 'ffe10000-0000-4000-8000-000000000010'
)) AS response;

UPDATE guest_booking_test_state
   SET booking_id = (SELECT (response->'data'->>'booking_id')::integer FROM guest_booking_test_response);

SELECT ok((SELECT response->>'type' = 'success' FROM guest_booking_test_response),
          'booking and initial payment request are created atomically');

SELECT is(
    (public.manage_guest_booking('create', jsonb_build_object(
        'room_id', (SELECT room_id FROM guest_booking_test_state),
        'full_name', 'Booking Test Guest',
        'phone', '09171000001',
        'move_in_date', (CURRENT_DATE + 30)::text,
        'check_out_date', (CURRENT_DATE + 90)::text,
        'payment_plan', 'Pay Monthly',
        'idempotency_key', 'ffe10000-0000-4000-8000-000000000010'
    ))->'data'->>'booking_id'),
    (SELECT booking_id::text FROM guest_booking_test_state),
    'duplicate booking request returns the original booking'
);
SELECT is(
    (SELECT count(*)::integer FROM public."bookings"
      WHERE "guest_user_id" = public.current_app_user_id()
        AND "request_id" = 'ffe10000-0000-4000-8000-000000000010'),
    1,
    'duplicate booking retries do not create a second booking'
);

SELECT set_config('request.jwt.claim.sub', (SELECT other_guest_auth_id::text FROM guest_booking_test_state), true);
SELECT throws_ok(
    format(
        $$SELECT public.manage_guest_booking('guest_cancel', jsonb_build_object('booking_id', %s))$$,
        (SELECT booking_id FROM guest_booking_test_state)
    ),
    'P0001',
    'Booking not found',
    'a different guest cannot cancel another guest booking'
);
SELECT throws_ok(
    format(
        $$SELECT public.manage_guest_booking('acquire_hold', jsonb_build_object(
            'room_id', %s, 'move_in_date', %L, 'check_out_date', %L
        ))$$,
        (SELECT room_id FROM guest_booking_test_state),
        (CURRENT_DATE + 30)::text,
        (CURRENT_DATE + 90)::text
    ),
    'P0001',
    'This room is unavailable for the selected dates',
    'a competing guest cannot reserve capacity consumed by a booking'
);

SELECT set_config('request.jwt.claim.sub', (SELECT guest_auth_id::text FROM guest_booking_test_state), true);
SELECT throws_ok(
    $$SELECT public.manage_guest_booking('submit_initial_payment', jsonb_build_object(
        'booking_id', (SELECT booking_id FROM guest_booking_test_state),
        'method', 'GCash',
        'reference', '   ',
        'screenshot_path',
            (SELECT guest_auth_id::text FROM guest_booking_test_state) || '/'
            || (SELECT booking_id::text FROM guest_booking_test_state)
            || '/ffe10000-0000-4000-8000-000000000013.png',
        'submission_key', 'ffe10000-0000-4000-8000-000000000013'
    ))$$,
    'P0001',
    'A GCash transaction reference is required',
    'a payment screenshot cannot replace the required GCash reference'
);
SELECT ok(
    (public.manage_guest_booking('submit_initial_payment', jsonb_build_object(
        'booking_id', (SELECT booking_id FROM guest_booking_test_state),
        'method', 'GCash',
        'reference', 'TEST-REFERENCE-001',
        'screenshot_path',
            (SELECT guest_auth_id::text FROM guest_booking_test_state) || '/'
            || (SELECT booking_id::text FROM guest_booking_test_state)
            || '/ffe10000-0000-4000-8000-000000000011.png',
        'submission_key', 'ffe10000-0000-4000-8000-000000000011'
    ))->>'type') = 'success',
    'guest can submit an initial payment reference and screenshot'
);
SELECT ok(
    (public.manage_guest_booking('submit_initial_payment', jsonb_build_object(
        'booking_id', (SELECT booking_id FROM guest_booking_test_state),
        'method', 'GCash',
        'reference', 'TEST-REFERENCE-001',
        'screenshot_path',
            (SELECT guest_auth_id::text FROM guest_booking_test_state) || '/'
            || (SELECT booking_id::text FROM guest_booking_test_state)
            || '/ffe10000-0000-4000-8000-000000000011.png',
        'submission_key', 'ffe10000-0000-4000-8000-000000000011'
    ))->>'type') = 'success',
    'replayed payment submission is idempotent'
);
SELECT is(
    (SELECT count(*)::integer FROM public."payments"
      WHERE "booking_id" = (SELECT booking_id FROM guest_booking_test_state)
        AND "payment_type" = 'Initial Booking Payment'),
    1,
    'payment retry creates one ledger row'
);

SELECT ok(
    (public.manage_guest_booking('guest_cancel', jsonb_build_object(
        'booking_id', (SELECT booking_id FROM guest_booking_test_state)
    ))->>'type') = 'success',
    'owner can cancel a pending-verification booking'
);
SELECT ok(
    (public.manage_guest_booking('guest_cancel', jsonb_build_object(
        'booking_id', (SELECT booking_id FROM guest_booking_test_state)
    ))->>'type') = 'success',
    'replayed cancellation is idempotent'
);
SELECT is(
    (SELECT "status" FROM public."bookings"
      WHERE "booking_id" = (SELECT booking_id FROM guest_booking_test_state)),
    'Cancelled',
    'cancellation releases the booking while retaining its ledger'
);

SELECT set_config('request.jwt.claim.sub', (SELECT other_guest_auth_id::text FROM guest_booking_test_state), true);
SELECT ok(
    (public.manage_guest_booking('acquire_hold', jsonb_build_object(
        'room_id', (SELECT room_id FROM guest_booking_test_state),
        'move_in_date', (CURRENT_DATE + 30)::text,
        'check_out_date', (CURRENT_DATE + 90)::text
    ))->>'type') = 'success',
    'released capacity is available to another guest'
);
SELECT ok(
    (public.manage_guest_booking('create', jsonb_build_object(
        'room_id', (SELECT room_id FROM guest_booking_test_state),
        'full_name', 'Other Booking Guest',
        'phone', '09171000002',
        'move_in_date', (CURRENT_DATE + 30)::text,
        'check_out_date', (CURRENT_DATE + 90)::text,
        'payment_plan', 'Pay Monthly',
        'idempotency_key', 'ffe10000-0000-4000-8000-000000000012'
    ))->>'type') = 'success',
    'second guest booking is persisted'
);
UPDATE public."bookings"
   SET "payment_expires_at" = CURRENT_TIMESTAMP - interval '1 second'
 WHERE "request_id" = 'ffe10000-0000-4000-8000-000000000012';
SELECT public.manage_guest_booking('guest_list', '{}'::jsonb);
SELECT is(
    (SELECT "status" FROM public."bookings"
      WHERE "request_id" = 'ffe10000-0000-4000-8000-000000000012'),
    'Expired',
    'unpaid booking expires and stops consuming capacity'
);

SELECT set_config('request.jwt.claim.sub', (SELECT admin_auth_id::text FROM guest_booking_test_state), true);
SELECT ok(
    (public.manage_guest_booking('admin_list', '{}'::jsonb)->>'type') = 'success',
    'authenticated Admin can review bookings'
);
SELECT is(
    (
        SELECT booking->>'gcash_submitted_screenshot'
          FROM jsonb_array_elements(public.manage_guest_booking('admin_list', '{}'::jsonb)->'data') AS rows(booking)
         WHERE (booking->>'booking_id')::integer = (SELECT booking_id FROM guest_booking_test_state)
    ),
    (SELECT guest_auth_id::text || '/' || booking_id::text || '/ffe10000-0000-4000-8000-000000000011.png'
       FROM guest_booking_test_state),
    'Admin booking list includes the submitted payment screenshot path'
);

SELECT set_config('request.jwt.claim.sub', (SELECT other_guest_auth_id::text FROM guest_booking_test_state), true);
SELECT ok(
    (public.manage_guest_booking('acquire_hold', jsonb_build_object(
        'room_id', (SELECT room_id FROM guest_booking_test_state),
        'move_in_date', (CURRENT_DATE + 30)::text,
        'check_out_date', (CURRENT_DATE + 90)::text
    ))->>'type') = 'success',
    'guest can hold released capacity before rollback test'
);

CREATE FUNCTION pg_temp.fail_booking_created_log() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."action" = 'booking_created' THEN
        RAISE EXCEPTION 'forced booking log failure';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "guest_booking_test_fail_log"
    BEFORE INSERT ON public."system_logs"
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_booking_created_log();

SELECT throws_ok(
    $$SELECT public.manage_guest_booking('create', jsonb_build_object(
        'room_id', (SELECT room_id FROM guest_booking_test_state),
        'full_name', 'Other Booking Guest',
        'phone', '09171000002',
        'move_in_date', (CURRENT_DATE + 30)::text,
        'check_out_date', (CURRENT_DATE + 90)::text,
        'payment_plan', 'Pay Monthly',
        'idempotency_key', 'ffe10000-0000-4000-8000-000000000013'
    ))$$,
    'P0001',
    'forced booking log failure',
    'booking creation rolls back when a coupled audit write fails'
);
DROP TRIGGER "guest_booking_test_fail_log" ON public."system_logs";
SELECT is(
    (SELECT count(*)::integer FROM public."bookings"
      WHERE "request_id" = 'ffe10000-0000-4000-8000-000000000013'),
    0,
    'failed booking transaction leaves no booking row'
);
SELECT is(
    (SELECT count(*)::integer FROM public."booking_room_holds"
      WHERE "user_id" = public.current_app_user_id()),
    1,
    'failed booking transaction preserves the caller room hold'
);

SELECT * FROM finish();
ROLLBACK;
