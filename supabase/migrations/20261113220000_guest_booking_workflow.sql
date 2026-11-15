-- Atomic guest reservation lifecycle and authenticated Admin booking review.
ALTER TABLE public."bookings"
    ADD COLUMN IF NOT EXISTS "guest_user_id" integer,
    ADD COLUMN IF NOT EXISTS "request_id" uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public."bookings"'::regclass
           AND conname = 'bookings_guest_user_fk'
    ) THEN
        ALTER TABLE public."bookings"
            ADD CONSTRAINT "bookings_guest_user_fk"
            FOREIGN KEY ("guest_user_id") REFERENCES public."users" ("user_id") ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "bookings_guest_request_key"
    ON public."bookings" ("guest_user_id", "request_id")
    WHERE "guest_user_id" IS NOT NULL AND "request_id" IS NOT NULL;

ALTER TABLE public."booking_initial_payment_requests"
    ADD COLUMN IF NOT EXISTS "submission_key" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "booking_initial_payment_submission_key"
    ON public."booking_initial_payment_requests" ("submission_key")
    WHERE "submission_key" IS NOT NULL;

ALTER TABLE public."payments"
    ADD COLUMN IF NOT EXISTS "idempotency_key" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_key"
    ON public."payments" ("idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "bookings_guest_user_created"
    ON public."bookings" ("guest_user_id", "created_at" DESC);

REVOKE ALL ON TABLE public."booking_room_holds",
    public."booking_initial_payment_requests",
    public."payment_proofs" FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public."bookings" FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public."payments" FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'mbh-booking-payment-proofs',
    'mbh-booking-payment-proofs',
    false,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects'
           AND policyname = 'mbh_booking_proof_insert_own'
    ) THEN
        CREATE POLICY "mbh_booking_proof_insert_own"
            ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'mbh-booking-payment-proofs'
                AND (storage.foldername(name))[1] = auth.uid()::text
                AND public.current_app_user_role() = 'Guest'
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects'
           AND policyname = 'mbh_booking_proof_read_owner_or_admin'
    ) THEN
        CREATE POLICY "mbh_booking_proof_read_owner_or_admin"
            ON storage.objects FOR SELECT TO authenticated
            USING (
                bucket_id = 'mbh-booking-payment-proofs'
                AND (
                    public.current_app_user_role() = 'Admin'
                    OR (storage.foldername(name))[1] = auth.uid()::text
                )
            );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_guest_booking(
    p_action text,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    actor_id integer;
    actor_role text;
    actor_email text;
    actor_name text;
    actor_phone text;
    room_row public."rooms"%ROWTYPE;
    booking_row public."bookings"%ROWTYPE;
    payment_request public."booking_initial_payment_requests"%ROWTYPE;
    payment_row public."payments"%ROWTYPE;
    room_id_value integer;
    booking_id_value integer;
    user_id_value integer;
    request_key uuid;
    payment_key uuid;
    hold_expiry timestamp without time zone;
    move_in_value date;
    check_out_value date;
    stay_months integer;
    total_rent_value numeric(10,2);
    initial_amount numeric(10,2);
    payment_amount numeric(10,2);
    payment_id_value integer;
    available_beds bigint;
    status_value text;
    method_value text;
    reference_value text;
    proof_path text;
    next_status text;
    result jsonb;
BEGIN
    SELECT u."user_id", u."user_type", lower(btrim(u."email")),
           u."full_name", u."phone"
      INTO actor_id, actor_role, actor_email, actor_name, actor_phone
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."is_active" = 1
     LIMIT 1;

    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'An active authenticated account is required';
    END IF;

    IF p_action LIKE 'admin_%' THEN
        IF actor_role <> 'Admin' THEN
            RAISE EXCEPTION 'Administrator access is required';
        END IF;
    ELSIF actor_role <> 'Guest' THEN
        RAISE EXCEPTION 'Guest access is required';
    END IF;

    IF p_action = 'guest_list' THEN
        UPDATE public."bookings" AS b
           SET "status" = 'Expired', "updated_at" = CURRENT_TIMESTAMP
         WHERE b."guest_user_id" = actor_id
           AND b."status" = 'Pending'
           AND b."payment_expires_at" <= CURRENT_TIMESTAMP
           AND NOT EXISTS (
               SELECT 1 FROM public."booking_initial_payment_requests" AS ip
                WHERE ip."booking_id" = b."booking_id"
                  AND ip."status" IN ('Submitted', 'Confirmed')
           );

        SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC, booking_id DESC), '[]'::jsonb)
          INTO result
          FROM (
              SELECT b."created_at", b."booking_id",
                     jsonb_build_object(
                         'booking_id', b."booking_id",
                         'full_name', b."full_name",
                         'email', b."email",
                         'phone', b."phone",
                         'room_id', b."room_id",
                         'room_number', r."room_number",
                         'room_type', r."room_type",
                         'room_status', r."status",
                         'reservation_type', b."reservation_type",
                         'occupant_count', b."occupant_count",
                         'move_in_date', b."move_in_date",
                         'check_out_date', b."check_out_date",
                         'length_of_stay_months', b."length_of_stay_months",
                         'monthly_rent', r."monthly_rent",
                         'payment_plan', b."payment_plan",
                         'total_rent', b."total_rent",
                         'initial_payment_amount', ip."amount",
                         'initial_payment_status', ip."status",
                         'initial_payment_paid', CASE WHEN ip."status" = 'Confirmed' THEN 1 ELSE 0 END,
                         'payment_expires_at_epoch', extract(epoch FROM b."payment_expires_at"),
                         'server_now_epoch', extract(epoch FROM CURRENT_TIMESTAMP),
                         'amount_paid', COALESCE((
                             SELECT sum(p."amount") FROM public."payments" AS p
                              WHERE p."booking_id" = b."booking_id"
                                AND p."status" IN ('Confirmed', 'Paid')
                         ), 0),
                         'amount_due', GREATEST(b."total_rent" - COALESCE((
                             SELECT sum(p."amount") FROM public."payments" AS p
                              WHERE p."booking_id" = b."booking_id"
                                AND p."status" IN ('Confirmed', 'Paid')
                         ), 0), 0),
                         'next_payment_due', (
                             SELECT min(p."due_date") FROM public."payments" AS p
                              WHERE p."booking_id" = b."booking_id"
                                AND p."status" IN ('Pending', 'Overdue')
                         ),
                         'notes', b."notes",
                         'status', b."status",
                         'created_at', b."created_at"
                     ) AS row_data
                FROM public."bookings" AS b
                LEFT JOIN public."rooms" AS r ON r."room_id" = b."room_id"
                LEFT JOIN public."booking_initial_payment_requests" AS ip
                       ON ip."booking_id" = b."booking_id"
               WHERE b."guest_user_id" = actor_id
          ) AS bookings;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF p_action = 'acquire_hold' THEN
        IF jsonb_typeof(p_data->'room_id') IS DISTINCT FROM 'number'
           OR (p_data->>'room_id') !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'Choose a valid room';
        END IF;
        room_id_value := (p_data->>'room_id')::integer;
        move_in_value := NULLIF(p_data->>'move_in_date', '')::date;
        check_out_value := NULLIF(p_data->>'check_out_date', '')::date;
        IF move_in_value IS NULL AND check_out_value IS NULL THEN
            move_in_value := CURRENT_DATE;
            check_out_value := CURRENT_DATE + 1;
        ELSIF move_in_value IS NULL OR check_out_value IS NULL
           OR move_in_value < CURRENT_DATE OR check_out_value <= move_in_value THEN
            RAISE EXCEPTION 'Choose valid move-in and move-out dates';
        END IF;

        PERFORM pg_catalog.pg_advisory_xact_lock(actor_id::bigint);
        SELECT r.* INTO room_row
          FROM public."rooms" AS r
         WHERE r."room_id" = room_id_value
         FOR UPDATE;
        IF room_row."room_id" IS NULL OR room_row."status" = 'Maintenance' THEN
            RAISE EXCEPTION 'This room is unavailable';
        END IF;

        SELECT a."available_beds" INTO available_beds
          FROM public.get_public_rooms_for_dates(move_in_value, check_out_value) AS a
         WHERE a."room_id" = room_id_value;
        IF COALESCE(available_beds, 0) < 1 THEN
            RAISE EXCEPTION 'This room is unavailable for the selected dates';
        END IF;

        hold_expiry := CURRENT_TIMESTAMP + interval '5 minutes';
        INSERT INTO public."booking_room_holds" (
            "user_id", "email", "room_id", "move_in_date", "check_out_date",
            "reservation_type", "occupant_count", "expires_at", "updated_at"
        ) VALUES (
            actor_id, actor_email, room_id_value, move_in_value, check_out_value,
            'capacity_based', 1, hold_expiry, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("user_id") DO UPDATE
            SET "email" = EXCLUDED."email",
                "room_id" = EXCLUDED."room_id",
                "move_in_date" = EXCLUDED."move_in_date",
                "check_out_date" = EXCLUDED."check_out_date",
                "reservation_type" = EXCLUDED."reservation_type",
                "occupant_count" = EXCLUDED."occupant_count",
                "expires_at" = EXCLUDED."expires_at",
                "updated_at" = CURRENT_TIMESTAMP;
        RETURN jsonb_build_object(
            'type', 'success',
            'message', 'Room held for five minutes',
            'data', jsonb_build_object('expires_at', hold_expiry)
        );
    END IF;

    IF p_action = 'release_hold' THEN
        DELETE FROM public."booking_room_holds" WHERE "user_id" = actor_id;
        RETURN jsonb_build_object('type', 'success', 'data', NULL);
    END IF;

    IF p_action = 'create' THEN
        IF jsonb_typeof(p_data->'room_id') IS DISTINCT FROM 'number'
           OR (p_data->>'room_id') !~ '^[1-9][0-9]{0,9}$'
           OR COALESCE(p_data->>'idempotency_key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'Room and booking request identifiers are required';
        END IF;
        room_id_value := (p_data->>'room_id')::integer;
        request_key := (p_data->>'idempotency_key')::uuid;

        SELECT b.* INTO booking_row
          FROM public."bookings" AS b
         WHERE b."guest_user_id" = actor_id AND b."request_id" = request_key;
        IF booking_row."booking_id" IS NOT NULL THEN
            RETURN jsonb_build_object(
                'type', 'success', 'message', 'Booking already created',
                'data', jsonb_build_object(
                    'booking_id', booking_row."booking_id",
                    'initial_payment_amount', (
                        SELECT ip."amount" FROM public."booking_initial_payment_requests" AS ip
                         WHERE ip."booking_id" = booking_row."booking_id"
                    ),
                    'payment_expires_at_epoch', extract(epoch FROM booking_row."payment_expires_at"),
                    'server_now_epoch', extract(epoch FROM CURRENT_TIMESTAMP)
                )
            );
        END IF;

        move_in_value := NULLIF(p_data->>'move_in_date', '')::date;
        check_out_value := NULLIF(p_data->>'check_out_date', '')::date;
        IF move_in_value IS NULL OR check_out_value IS NULL
           OR move_in_value < CURRENT_DATE OR check_out_value < (move_in_value + interval '1 month')::date THEN
            RAISE EXCEPTION 'Choose a valid stay of at least one month';
        END IF;
        stay_months := ((extract(year FROM check_out_value) - extract(year FROM move_in_value)) * 12
                        + extract(month FROM check_out_value) - extract(month FROM move_in_value))::integer
                       + CASE WHEN extract(day FROM check_out_value) > extract(day FROM move_in_value) THEN 1 ELSE 0 END;
        stay_months := GREATEST(stay_months, 1);
        IF stay_months > 120 THEN
            RAISE EXCEPTION 'Stay length cannot exceed 120 months';
        END IF;

        IF COALESCE(p_data->>'payment_plan', '') NOT IN ('Pay Monthly', 'Pay One Month Rent', 'Pay in Full') THEN
            RAISE EXCEPTION 'Choose a supported payment plan';
        END IF;
        PERFORM pg_catalog.pg_advisory_xact_lock(actor_id::bigint);
        SELECT b.* INTO booking_row
          FROM public."bookings" AS b
         WHERE b."guest_user_id" = actor_id AND b."request_id" = request_key;
        IF booking_row."booking_id" IS NOT NULL THEN
            RETURN jsonb_build_object(
                'type', 'success', 'message', 'Booking already created',
                'data', jsonb_build_object(
                    'booking_id', booking_row."booking_id",
                    'initial_payment_amount', (
                        SELECT ip."amount" FROM public."booking_initial_payment_requests" AS ip
                         WHERE ip."booking_id" = booking_row."booking_id"
                    ),
                    'payment_expires_at_epoch', extract(epoch FROM booking_row."payment_expires_at"),
                    'server_now_epoch', extract(epoch FROM CURRENT_TIMESTAMP)
                )
            );
        END IF;
        SELECT r.* INTO room_row
          FROM public."rooms" AS r
         WHERE r."room_id" = room_id_value
         FOR UPDATE;
        IF room_row."room_id" IS NULL OR room_row."status" = 'Maintenance' THEN
            RAISE EXCEPTION 'This room is unavailable';
        END IF;
        PERFORM 1
          FROM public."booking_room_holds" AS h
         WHERE h."user_id" = actor_id
           AND h."room_id" = room_id_value
           AND h."expires_at" > CURRENT_TIMESTAMP
           AND h."move_in_date" = move_in_value
           AND h."check_out_date" = check_out_value
         FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Your room hold expired. Please reserve the room again';
        END IF;
        SELECT a."available_beds" INTO available_beds
          FROM public.get_public_rooms_for_dates(move_in_value, check_out_value) AS a
         WHERE a."room_id" = room_id_value;
        IF COALESCE(available_beds, 0) < 1 THEN
            RAISE EXCEPTION 'This room is unavailable for the selected dates';
        END IF;

        total_rent_value := round(room_row."monthly_rent" * stay_months, 2);
        initial_amount := CASE p_data->>'payment_plan'
            WHEN 'Pay in Full' THEN total_rent_value
            WHEN 'Pay One Month Rent' THEN room_row."monthly_rent"
            ELSE room_row."monthly_rent" * 2
        END;
        INSERT INTO public."bookings" (
            "guest_user_id", "request_id", "full_name", "email", "phone", "room_id",
            "reservation_type", "occupant_count", "move_in_date", "check_out_date",
            "length_of_stay_months", "payment_plan", "total_rent", "notes",
            "status", "payment_expires_at", "created_at", "updated_at"
        ) VALUES (
            actor_id, request_key,
            COALESCE(NULLIF(btrim(p_data->>'full_name'), ''), actor_name),
            actor_email,
            COALESCE(NULLIF(btrim(p_data->>'phone'), ''), actor_phone),
            room_id_value, 'capacity_based', 1, move_in_value, check_out_value,
            stay_months, p_data->>'payment_plan', total_rent_value,
            NULLIF(left(btrim(COALESCE(p_data->>'notes', '')), 2000), ''),
            'Pending', CURRENT_TIMESTAMP + interval '30 minutes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING "booking_id" INTO booking_id_value;

        INSERT INTO public."booking_initial_payment_requests" (
            "booking_id", "method", "status", "amount", "created_at", "updated_at"
        ) VALUES (
            booking_id_value, 'GCash', 'Checkout', initial_amount, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
        DELETE FROM public."booking_room_holds" WHERE "user_id" = actor_id;
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (
            actor_id, 'booking', 'booking_created',
            'Guest booking #' || booking_id_value || ' created for room ' || room_row."room_number"
        );
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT u."user_id", 'New Guest Booking',
               actor_name || ' created booking #' || booking_id_value || ' for Room ' || room_row."room_number",
               'booking'
          FROM public."users" AS u
         WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
        RETURN jsonb_build_object(
            'type', 'success',
            'message', 'Room temporarily reserved',
            'data', jsonb_build_object(
                'booking_id', booking_id_value,
                'initial_payment_amount', initial_amount,
                'payment_expires_at_epoch', extract(epoch FROM CURRENT_TIMESTAMP + interval '30 minutes'),
                'server_now_epoch', extract(epoch FROM CURRENT_TIMESTAMP)
            )
        );
    END IF;

    IF p_action = 'submit_initial_payment' THEN
        IF COALESCE(p_data->>'booking_id', '') !~ '^[1-9][0-9]{0,9}$'
           OR COALESCE(p_data->>'submission_key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'A valid booking and payment submission identifier are required';
        END IF;
        booking_id_value := (p_data->>'booking_id')::integer;
        payment_key := (p_data->>'submission_key')::uuid;
        reference_value := NULLIF(btrim(p_data->>'reference'), '');
        proof_path := NULLIF(p_data->>'screenshot_path', '');
        method_value := p_data->>'method';
        IF method_value <> 'GCash' OR length(reference_value) > 120 THEN
            RAISE EXCEPTION 'Enter a valid GCash reference';
        END IF;
        IF proof_path IS NOT NULL AND (
            left(proof_path, length(auth.uid()::text || '/' || booking_id_value::text || '/' || payment_key::text || '.'))
                <> auth.uid()::text || '/' || booking_id_value::text || '/' || payment_key::text || '.'
            OR proof_path !~ '\.(jpg|png|webp)$'
        ) THEN
            RAISE EXCEPTION 'Payment proof path is invalid';
        END IF;
        IF reference_value IS NULL AND proof_path IS NULL THEN
            RAISE EXCEPTION 'Provide a GCash reference or payment screenshot';
        END IF;

        SELECT b.* INTO booking_row
          FROM public."bookings" AS b
         WHERE b."booking_id" = booking_id_value
           AND b."guest_user_id" = actor_id
         FOR UPDATE;
        IF booking_row."booking_id" IS NULL THEN
            RAISE EXCEPTION 'Booking not found';
        END IF;
        SELECT ip.* INTO payment_request
          FROM public."booking_initial_payment_requests" AS ip
         WHERE ip."booking_id" = booking_id_value
         FOR UPDATE;
        IF payment_request."status" = 'Submitted' AND payment_request."submission_key" = payment_key THEN
            RETURN jsonb_build_object('type', 'success', 'message', 'Payment is already awaiting review');
        END IF;
        SELECT p.* INTO payment_row
          FROM public."payments" AS p
         WHERE p."idempotency_key" = payment_key;
        IF payment_row."payment_id" IS NOT NULL THEN
            RAISE EXCEPTION 'Payment submission identifier has already been used';
        END IF;
        IF payment_request."status" <> 'Checkout'
           OR booking_row."status" <> 'Pending'
           OR booking_row."payment_expires_at" <= CURRENT_TIMESTAMP THEN
            RAISE EXCEPTION 'This booking is no longer accepting an initial payment';
        END IF;

        UPDATE public."booking_initial_payment_requests"
           SET "status" = 'Submitted',
               "method" = method_value,
               "reference_number" = reference_value,
               "screenshot_path" = proof_path,
               "submission_key" = payment_key,
               "submitted_at" = CURRENT_TIMESTAMP,
               "updated_at" = CURRENT_TIMESTAMP
         WHERE "booking_id" = booking_id_value;
        INSERT INTO public."payments" (
            "booking_id", "amount", "due_date", "status", "description",
            "payment_type", "method", "gateway", "reference_number",
            "submitted_at", "created_at", "idempotency_key"
        ) VALUES (
            booking_id_value, payment_request."amount", booking_row."move_in_date",
            'Submitted', 'Initial booking payment', 'Initial Booking Payment',
            method_value, 'gcash', reference_value, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, payment_key
        )
        RETURNING "payment_id" INTO payment_id_value;

        IF proof_path IS NOT NULL AND payment_id_value IS NOT NULL THEN
            INSERT INTO public."payment_proofs" ("payment_id", "screenshot_path", "uploaded_at")
            VALUES (payment_id_value, proof_path, CURRENT_TIMESTAMP)
            ON CONFLICT ("payment_id") DO UPDATE
                SET "screenshot_path" = EXCLUDED."screenshot_path",
                    "uploaded_at" = EXCLUDED."uploaded_at";
        END IF;
        UPDATE public."bookings"
           SET "status" = 'Pending Verification', "updated_at" = CURRENT_TIMESTAMP
         WHERE "booking_id" = booking_id_value;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT u."user_id", 'Booking Payment Submitted',
               'Guest ' || booking_row."full_name" || ' submitted an initial payment for booking #' || booking_id_value,
               'booking'
          FROM public."users" AS u
         WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
        RETURN jsonb_build_object('type', 'success', 'message', 'Payment submitted for administrator review');
    END IF;

    IF p_action = 'guest_cancel' THEN
        IF COALESCE(p_data->>'booking_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'A valid booking ID is required';
        END IF;
        booking_id_value := (p_data->>'booking_id')::integer;
        SELECT b.* INTO booking_row
          FROM public."bookings" AS b
         WHERE b."booking_id" = booking_id_value
           AND b."guest_user_id" = actor_id
         FOR UPDATE;
        IF booking_row."booking_id" IS NULL THEN
            RAISE EXCEPTION 'Booking not found';
        END IF;
        IF booking_row."status" = 'Cancelled' THEN
            RETURN jsonb_build_object('type', 'success', 'message', 'Booking is already cancelled');
        END IF;
        IF booking_row."status" NOT IN ('Pending', 'Pending Verification', 'Confirmed') THEN
            RAISE EXCEPTION 'This booking can no longer be cancelled online';
        END IF;
        UPDATE public."bookings"
           SET "status" = 'Cancelled', "updated_at" = CURRENT_TIMESTAMP
         WHERE "booking_id" = booking_id_value;
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'booking', 'booking_cancelled', 'Guest cancelled booking #' || booking_id_value);
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT u."user_id", 'Guest Booking Cancelled',
               'Guest ' || booking_row."full_name" || ' cancelled booking #' || booking_id_value,
               'booking'
          FROM public."users" AS u
         WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
        RETURN jsonb_build_object('type', 'success', 'message', 'Booking cancelled');
    END IF;

    IF p_action = 'admin_list' OR p_action = 'admin_cancelled_list' THEN
        UPDATE public."bookings" AS b
           SET "status" = 'Expired', "updated_at" = CURRENT_TIMESTAMP
         WHERE b."status" = 'Pending'
           AND b."payment_expires_at" <= CURRENT_TIMESTAMP
           AND NOT EXISTS (
               SELECT 1 FROM public."booking_initial_payment_requests" AS ip
                WHERE ip."booking_id" = b."booking_id"
                  AND ip."status" IN ('Submitted', 'Confirmed')
           );
        SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC, booking_id DESC), '[]'::jsonb)
          INTO result
          FROM (
              SELECT b."created_at", b."booking_id",
                     jsonb_build_object(
                         'booking_id', b."booking_id",
                         'full_name', b."full_name",
                         'email', b."email",
                         'phone', b."phone",
                         'room_id', b."room_id",
                         'room_number', r."room_number",
                         'reservation_type', b."reservation_type",
                         'occupant_count', b."occupant_count",
                         'monthly_rent', r."monthly_rent",
                         'move_in_date', b."move_in_date",
                         'check_out_date', b."check_out_date",
                         'payment_plan', b."payment_plan",
                         'total_rent', b."total_rent",
                         'amount_paid', COALESCE((
                             SELECT sum(p."amount") FROM public."payments" AS p
                              WHERE p."booking_id" = b."booking_id"
                                AND p."status" IN ('Confirmed', 'Paid')
                         ), 0),
                         'next_payment_due', (
                             SELECT min(p."due_date") FROM public."payments" AS p
                              WHERE p."booking_id" = b."booking_id"
                                AND p."status" IN ('Pending', 'Overdue')
                         ),
                         'status', b."status",
                         'notes', b."notes",
                         'created_at', b."created_at",
                         'gcash_submitted_reference', ip."reference_number",
                         'gcash_submitted_screenshot', ip."screenshot_path",
                         'initial_payment_status', ip."status",
                         'initial_payment_amount', ip."amount"
                     ) AS row_data
                FROM public."bookings" AS b
                LEFT JOIN public."rooms" AS r ON r."room_id" = b."room_id"
                LEFT JOIN public."booking_initial_payment_requests" AS ip
                       ON ip."booking_id" = b."booking_id"
               WHERE (p_action <> 'admin_cancelled_list' OR b."status" = 'Cancelled')
          ) AS booking_list;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF p_action IN ('admin_confirm_initial_payment', 'admin_reject_initial_payment') THEN
        IF COALESCE(p_data->>'booking_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'A valid booking ID is required';
        END IF;
        booking_id_value := (p_data->>'booking_id')::integer;
        SELECT b.* INTO booking_row
          FROM public."bookings" AS b
         WHERE b."booking_id" = booking_id_value
         FOR UPDATE;
        SELECT ip.* INTO payment_request
          FROM public."booking_initial_payment_requests" AS ip
         WHERE ip."booking_id" = booking_id_value
         FOR UPDATE;
        IF booking_row."booking_id" IS NULL OR payment_request."booking_id" IS NULL THEN
            RAISE EXCEPTION 'Booking payment not found';
        END IF;
        next_status := CASE p_action
            WHEN 'admin_confirm_initial_payment' THEN 'Confirmed'
            ELSE 'Rejected'
        END;
        IF payment_request."status" = next_status THEN
            RETURN jsonb_build_object('type', 'success', 'message', 'Payment decision was already recorded');
        END IF;
        IF payment_request."status" <> 'Submitted'
           OR booking_row."status" <> 'Pending Verification' THEN
            RAISE EXCEPTION 'This initial payment is not awaiting review';
        END IF;
        UPDATE public."booking_initial_payment_requests"
           SET "status" = next_status, "updated_at" = CURRENT_TIMESTAMP
         WHERE "booking_id" = booking_id_value;
        UPDATE public."payments"
           SET "status" = next_status,
               "confirmed_by" = CASE WHEN next_status = 'Confirmed' THEN actor_id ELSE NULL END,
               "confirmation_date" = CASE WHEN next_status = 'Confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE "booking_id" = booking_id_value
           AND "idempotency_key" = payment_request."submission_key";
        UPDATE public."bookings"
           SET "status" = next_status, "updated_at" = CURRENT_TIMESTAMP
         WHERE "booking_id" = booking_id_value;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        VALUES (
            booking_row."guest_user_id",
            CASE WHEN next_status = 'Confirmed' THEN 'Booking Confirmed' ELSE 'Booking Payment Rejected' END,
            CASE WHEN next_status = 'Confirmed'
                 THEN 'Your booking #' || booking_id_value || ' has been confirmed.'
                 ELSE 'Your initial payment for booking #' || booking_id_value || ' was rejected. Please contact the administrator.'
            END,
            'booking'
        );
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'booking', 'initial_payment_' || lower(next_status),
                'Admin ' || actor_id || ' marked initial payment for booking #' || booking_id_value || ' as ' || next_status);
        RETURN jsonb_build_object('type', 'success', 'message', 'Initial payment ' || lower(next_status));
    END IF;

    IF p_action = 'admin_set_status' THEN
        IF COALESCE(p_data->>'booking_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'A valid booking ID is required';
        END IF;
        booking_id_value := (p_data->>'booking_id')::integer;
        next_status := p_data->>'status';
        IF next_status NOT IN ('Pending', 'Confirmed', 'Checked In', 'Active', 'Checked Out', 'Cancelled') THEN
            RAISE EXCEPTION 'Unsupported booking status';
        END IF;
        SELECT b.* INTO booking_row
          FROM public."bookings" AS b
         WHERE b."booking_id" = booking_id_value
         FOR UPDATE;
        IF booking_row."booking_id" IS NULL THEN
            RAISE EXCEPTION 'Booking not found';
        END IF;
        IF booking_row."status" = next_status THEN
            RETURN jsonb_build_object('type', 'success', 'message', 'Booking status was already set');
        END IF;
        IF NOT (
            (booking_row."status" = 'Pending' AND next_status IN ('Confirmed', 'Cancelled'))
            OR (booking_row."status" = 'Pending Verification' AND next_status IN ('Confirmed', 'Cancelled'))
            OR (booking_row."status" = 'Confirmed' AND next_status IN ('Checked In', 'Cancelled'))
            OR (booking_row."status" = 'Checked In' AND next_status IN ('Active', 'Checked Out'))
            OR (booking_row."status" = 'Active' AND next_status = 'Checked Out')
        ) THEN
            RAISE EXCEPTION 'Invalid booking status transition';
        END IF;
        IF next_status = 'Confirmed' AND NOT EXISTS (
            SELECT 1 FROM public."booking_initial_payment_requests" AS ip
             WHERE ip."booking_id" = booking_id_value AND ip."status" = 'Confirmed'
        ) THEN
            RAISE EXCEPTION 'Confirm the initial payment before confirming the booking';
        END IF;
        UPDATE public."bookings"
           SET "status" = next_status,
               "checked_in_at" = CASE WHEN next_status = 'Checked In' THEN CURRENT_TIMESTAMP ELSE "checked_in_at" END,
               "checked_out_at" = CASE WHEN next_status = 'Checked Out' THEN CURRENT_TIMESTAMP ELSE "checked_out_at" END,
               "updated_at" = CURRENT_TIMESTAMP
         WHERE "booking_id" = booking_id_value;
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'booking', 'booking_status_changed',
                'Admin changed booking #' || booking_id_value || ' from ' || booking_row."status" || ' to ' || next_status);
        RETURN jsonb_build_object('type', 'success', 'message', 'Booking status updated');
    END IF;

    IF p_action = 'admin_record_payment' THEN
        IF COALESCE(p_data->>'booking_id', '') !~ '^[1-9][0-9]{0,9}$'
           OR COALESCE(p_data->>'idempotency_key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'A valid booking and payment request identifier are required';
        END IF;
        booking_id_value := (p_data->>'booking_id')::integer;
        payment_key := (p_data->>'idempotency_key')::uuid;
        payment_amount := NULLIF(p_data->>'amount', '')::numeric;
        method_value := p_data->>'method';
        reference_value := NULLIF(btrim(p_data->>'reference'), '');
        IF payment_amount IS NULL OR payment_amount <= 0 OR payment_amount > 99999999
           OR method_value NOT IN ('GCash', 'Bank Transfer', 'Cash')
           OR length(reference_value) > 120 THEN
            RAISE EXCEPTION 'Enter a valid payment amount, method, and reference';
        END IF;
        SELECT b.* INTO booking_row
          FROM public."bookings" AS b
         WHERE b."booking_id" = booking_id_value
         FOR UPDATE;
        IF booking_row."booking_id" IS NULL
           OR booking_row."status" IN ('Cancelled', 'Rejected', 'Expired') THEN
            RAISE EXCEPTION 'Payment cannot be added to this booking';
        END IF;
        SELECT p.* INTO payment_row
          FROM public."payments" AS p
         WHERE p."idempotency_key" = payment_key;
        IF payment_row."payment_id" IS NOT NULL THEN
            IF payment_row."booking_id" = booking_id_value
               AND payment_row."amount" = payment_amount
               AND payment_row."method" = method_value
               AND payment_row."reference_number" IS NOT DISTINCT FROM reference_value THEN
                RETURN jsonb_build_object('type', 'success', 'message', 'Payment already recorded');
            END IF;
            RAISE EXCEPTION 'Payment idempotency key was already used for a different payment';
        END IF;
        IF payment_amount > GREATEST(booking_row."total_rent" - COALESCE((
            SELECT sum(p."amount") FROM public."payments" AS p
             WHERE p."booking_id" = booking_id_value
               AND p."status" IN ('Confirmed', 'Paid')
        ), 0), 0) THEN
            RAISE EXCEPTION 'Payment exceeds the remaining booking balance';
        END IF;
        INSERT INTO public."payments" (
            "booking_id", "amount", "due_date", "status", "description",
            "payment_type", "method", "gateway", "reference_number",
            "confirmed_by", "confirmation_date", "paid_at", "created_at", "idempotency_key"
        ) VALUES (
            booking_id_value, payment_amount, CURRENT_DATE, 'Confirmed',
            'Admin-recorded booking payment', 'Booking Payment', method_value, 'manual',
            reference_value, actor_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, payment_key
        );
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'booking', 'booking_payment_recorded',
                'Admin recorded payment for booking #' || booking_id_value || ' (₱' || payment_amount || ')');
        RETURN jsonb_build_object('type', 'success', 'message', 'Payment recorded');
    END IF;

    RAISE EXCEPTION 'Invalid booking action';
END;
$$;

REVOKE ALL ON FUNCTION public.manage_guest_booking(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_guest_booking(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_guest_booking_boundary_dates(
    p_room_id integer,
    p_from date,
    p_until date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_role text;
    caller_email text;
    days jsonb;
BEGIN
    SELECT u."user_type", lower(btrim(u."email"))
      INTO caller_role, caller_email
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid() AND u."is_active" = 1;
    IF caller_role IS DISTINCT FROM 'Guest' THEN
        RAISE EXCEPTION 'Guest access is required';
    END IF;
    IF p_room_id IS NULL OR p_from IS NULL OR p_until <= p_from
       OR p_until > p_from + 366 THEN
        RAISE EXCEPTION 'Choose a valid room date range';
    END IF;
    SELECT COALESCE(jsonb_agg(d.day::text ORDER BY d.day), '[]'::jsonb)
      INTO days
      FROM generate_series(p_from, p_until, interval '1 day') AS d(day)
      JOIN public."rooms" AS r ON r."room_id" = p_room_id
      LEFT JOIN LATERAL (
          SELECT COALESCE(sum(
                     CASE WHEN t."reservation_type" = 'entire_room' THEN r."capacity"
                          ELSE LEAST(GREATEST(t."occupant_count", 1), r."capacity") END
                 ), 0)::bigint AS beds
            FROM public."tenants" AS t
           WHERE t."room_id" = p_room_id
             AND t."is_active" = 1
             AND t."move_in_date" < d.day::date + 1
             AND COALESCE(t."move_out_date", '9999-12-31'::date) > d.day::date
      ) AS tenant_load ON true
      LEFT JOIN LATERAL (
          SELECT COALESCE(sum(
                     CASE WHEN b."reservation_type" = 'entire_room' THEN r."capacity"
                          ELSE LEAST(GREATEST(b."occupant_count", 1), r."capacity") END
                 ), 0)::bigint AS beds
            FROM public."bookings" AS b
           WHERE b."room_id" = p_room_id
             AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
             AND b."move_in_date" < d.day::date + 1
             AND b."check_out_date" > d.day::date
             AND (
                 b."status" <> 'Pending'
                 OR b."payment_expires_at" > CURRENT_TIMESTAMP
                 OR EXISTS (
                     SELECT 1 FROM public."booking_initial_payment_requests" AS ip
                      WHERE ip."booking_id" = b."booking_id"
                        AND ip."status" IN ('Submitted', 'Confirmed')
                 )
                 OR EXISTS (
                     SELECT 1 FROM public."payments" AS ip
                      WHERE ip."booking_id" = b."booking_id"
                        AND ip."payment_type" = CASE
                            WHEN b."payment_plan" = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                            ELSE 'Security Deposit'
                        END
                        AND ip."status" IN ('Submitted', 'Confirmed', 'Paid')
                 )
             )
             AND NOT EXISTS (
                 SELECT 1 FROM public."tenants" AS t
                  WHERE t."room_id" = b."room_id"
                    AND t."is_active" = 1
                    AND lower(btrim(t."email")) = lower(btrim(b."email"))
                    AND t."move_in_date" < b."check_out_date"
                    AND COALESCE(t."move_out_date", '9999-12-31'::date) > b."move_in_date"
             )
      ) AS booking_load ON true
      LEFT JOIN LATERAL (
          SELECT COALESCE(sum(
                     CASE WHEN h."reservation_type" = 'entire_room' THEN r."capacity"
                          ELSE LEAST(GREATEST(h."occupant_count", 1), r."capacity") END
                 ), 0)::bigint AS beds
            FROM public."booking_room_holds" AS h
           WHERE h."room_id" = p_room_id
             AND h."expires_at" > CURRENT_TIMESTAMP
             AND lower(btrim(h."email")) <> caller_email
             AND (h."move_in_date" IS NULL OR h."check_out_date" IS NULL
                  OR (h."move_in_date" < d.day::date + 1 AND h."check_out_date" > d.day::date))
      ) AS hold_load ON true
     WHERE r."status" = 'Maintenance'
        OR tenant_load.beds + booking_load.beds + hold_load.beds >= r."capacity";
    RETURN days;
END;
$$;

REVOKE ALL ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) TO authenticated;
