CREATE OR REPLACE FUNCTION public.manage_stay_extension(
    p_action text,
    p_auth_user_id uuid,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    app_user_id integer;
    app_user_type text;
    v_request_id bigint;
    v_booking_id integer;
    v_tenant_id integer;
    v_requested_by integer;
    v_original_checkout date;
    v_requested_checkout date;
    v_current_checkout date;
    v_check_in date;
    v_booking_status text;
    v_request_status text;
    v_decision text;
    v_room_id integer;
    v_payment_plan text;
    v_total_rent numeric;
    v_length_months integer;
    v_new_length_months integer;
    v_added_months integer;
    v_monthly_rent numeric;
    v_applicable_charge numeric := 0;
    v_new_total numeric;
    v_due_date date;
    v_month_start date;
    v_month_index integer;
    v_result jsonb;
BEGIN
    SELECT u."user_id", u."user_type"
      INTO app_user_id, app_user_type
      FROM public."users" AS u
     WHERE u."auth_user_id" = p_auth_user_id
       AND u."is_active" = 1;

    IF app_user_id IS NULL THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'Active account not found.');
    END IF;

    IF p_action = 'tenant_request' THEN
        IF app_user_type <> 'Tenant' THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Tenant access is required.');
        END IF;

        IF COALESCE(p_data ->> 'requested_check_out_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Select a valid new move-out date.');
        END IF;
        BEGIN
            v_requested_checkout := (p_data ->> 'requested_check_out_date')::date;
        EXCEPTION
            WHEN datetime_field_overflow OR invalid_datetime_format THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Select a valid new move-out date.');
        END;

        SELECT b."booking_id", t."tenant_id", b."check_out_date", b."status"
          INTO v_booking_id, v_tenant_id, v_original_checkout, v_booking_status
          FROM public."users" AS u
          INNER JOIN public."tenants" AS t ON t."user_id" = u."user_id" AND t."is_active" = 1
          INNER JOIN public."bookings" AS b ON b."room_id" = t."room_id"
         WHERE u."auth_user_id" = p_auth_user_id
           AND u."is_active" = 1
           AND u."user_type" = 'Tenant'
           AND b."status" IN ('Confirmed', 'Checked In', 'Active')
           AND b."check_out_date" IS NOT NULL
           AND (
               (NULLIF(btrim(u."email"), '') IS NOT NULL
                AND lower(btrim(b."email")) = lower(btrim(u."email")))
               OR (NULLIF(btrim(t."email"), '') IS NOT NULL
                   AND lower(btrim(b."email")) = lower(btrim(t."email")))
               OR (
                   t."move_in_date" = b."move_in_date"
                   AND lower(btrim(t."full_name")) = lower(btrim(b."full_name"))
                   AND t."phone" = b."phone"
               )
           )
         ORDER BY t."tenant_id" DESC, b."created_at" DESC, b."booking_id" DESC
         LIMIT 1
         FOR UPDATE OF b, t;

        IF v_booking_id IS NULL OR v_original_checkout IS NULL THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'No active booking with a move-out date was found.');
        END IF;
        IF v_requested_checkout <= v_original_checkout THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'The new move-out date must be later than your current move-out date.');
        END IF;
        IF EXISTS (
            SELECT 1
              FROM public."stay_change_requests" AS scr
             WHERE scr."booking_id" = v_booking_id
               AND scr."request_type" = 'Extension'
               AND scr."status" = 'Pending'
        ) THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'You already have a pending extension request.');
        END IF;

        INSERT INTO public."stay_change_requests" (
            "booking_id", "request_type", "original_check_out_date",
            "requested_check_out_date", "status", "requested_by"
        )
        VALUES (
            v_booking_id, 'Extension', v_original_checkout,
            v_requested_checkout, 'Pending', app_user_id
        )
        RETURNING "request_id" INTO v_request_id;

        RETURN jsonb_build_object(
            'type', 'success',
            'message', 'Stay extension request submitted for admin approval.',
            'request_id', v_request_id
        );
    END IF;

    IF p_action = 'admin_list' OR p_action = 'admin_decide' THEN
        IF app_user_type <> 'Admin' THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Administrator access is required.');
        END IF;
    ELSE
        RETURN jsonb_build_object('type', 'error', 'message', 'Invalid stay extension action.');
    END IF;

    IF p_action = 'admin_list' THEN
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'request_id', scr."request_id",
                    'booking_id', scr."booking_id",
                    'original_check_out_date', scr."original_check_out_date",
                    'requested_check_out_date', scr."requested_check_out_date",
                    'status', scr."status",
                    'created_at', scr."created_at",
                    'full_name', b."full_name",
                    'email', b."email",
                    'room_number', r."room_number",
                    'monthly_rent', COALESCE(
                        NULLIF(b."total_rent" / NULLIF(b."length_of_stay_months", 0), 0),
                        r."monthly_rent"
                    )
                )
                ORDER BY CASE scr."status"
                    WHEN 'Pending' THEN 0
                    WHEN 'Approved' THEN 1
                    ELSE 2
                END, scr."created_at" DESC
            ),
            '[]'::jsonb
        )
          INTO v_result
          FROM public."stay_change_requests" AS scr
          INNER JOIN public."bookings" AS b ON b."booking_id" = scr."booking_id"
          LEFT JOIN public."rooms" AS r ON r."room_id" = b."room_id"
         WHERE scr."request_type" = 'Extension';

        RETURN jsonb_build_object('type', 'success', 'data', v_result);
    END IF;

    IF COALESCE(p_data ->> 'request_id', '') !~ '^\d{1,10}$'
       OR COALESCE(p_data ->> 'decision', '') NOT IN ('Approved', 'Rejected') THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'Invalid extension request decision.');
    END IF;
    v_request_id := (p_data ->> 'request_id')::bigint;
    IF v_request_id > 2147483647 THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'Invalid extension request decision.');
    END IF;
    v_decision := p_data ->> 'decision';

    SELECT scr."booking_id", scr."original_check_out_date",
           scr."requested_check_out_date", scr."status", scr."requested_by"
      INTO v_booking_id, v_original_checkout, v_requested_checkout,
           v_request_status, v_requested_by
      FROM public."stay_change_requests" AS scr
     WHERE scr."request_id" = v_request_id
       AND scr."request_type" = 'Extension'
     FOR UPDATE;

    IF v_booking_id IS NULL OR v_request_status <> 'Pending' THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'This extension request is no longer pending.');
    END IF;

    SELECT b."room_id", b."move_in_date", b."check_out_date", b."payment_plan",
           b."total_rent", b."length_of_stay_months", b."status",
           COALESCE(
               NULLIF(b."total_rent" / NULLIF(b."length_of_stay_months", 0), 0),
               r."monthly_rent"
           )
      INTO v_room_id, v_check_in, v_current_checkout, v_payment_plan,
           v_total_rent, v_length_months, v_booking_status, v_monthly_rent
      FROM public."bookings" AS b
      LEFT JOIN public."rooms" AS r ON r."room_id" = b."room_id"
     WHERE b."booking_id" = v_booking_id
     FOR UPDATE OF b;

    IF v_room_id IS NULL OR v_booking_status IS NULL THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'The booking for this extension request no longer exists.');
    END IF;

    IF v_decision = 'Approved' THEN
        IF v_booking_status NOT IN ('Confirmed', 'Checked In', 'Active') THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Only an active booking can be extended.');
        END IF;
        IF v_check_in IS NULL OR v_current_checkout IS DISTINCT FROM v_original_checkout
           OR v_requested_checkout <= v_original_checkout OR v_monthly_rent IS NULL OR v_monthly_rent <= 0 THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'The booking or extension dates are invalid or have changed.');
        END IF;
        IF EXISTS (
            SELECT 1
              FROM public."bookings" AS other_booking
             WHERE other_booking."room_id" = v_room_id
               AND other_booking."booking_id" <> v_booking_id
               AND other_booking."status" IN ('Pending', 'Confirmed', 'Checked In', 'Active')
               AND other_booking."move_in_date" < v_requested_checkout
               AND other_booking."check_out_date" > v_original_checkout
        ) THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'The room is already booked during the requested extension.');
        END IF;

        v_length_months :=
            ((EXTRACT(YEAR FROM v_original_checkout)::integer - EXTRACT(YEAR FROM v_check_in)::integer) * 12)
            + EXTRACT(MONTH FROM v_original_checkout)::integer
            - EXTRACT(MONTH FROM v_check_in)::integer
            + CASE WHEN EXTRACT(DAY FROM v_original_checkout) > EXTRACT(DAY FROM v_check_in) THEN 1 ELSE 0 END;
        v_new_length_months :=
            ((EXTRACT(YEAR FROM v_requested_checkout)::integer - EXTRACT(YEAR FROM v_check_in)::integer) * 12)
            + EXTRACT(MONTH FROM v_requested_checkout)::integer
            - EXTRACT(MONTH FROM v_check_in)::integer
            + CASE WHEN EXTRACT(DAY FROM v_requested_checkout) > EXTRACT(DAY FROM v_check_in) THEN 1 ELSE 0 END;
        v_length_months := GREATEST(1, v_length_months);
        v_new_length_months := GREATEST(1, v_new_length_months);
        v_added_months := v_new_length_months - v_length_months;
        IF v_added_months <= 0 THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'The requested date does not add any billable rent period.');
        END IF;

        v_applicable_charge := round(v_monthly_rent * v_added_months, 2);
        v_new_total := round(v_total_rent + v_applicable_charge, 2);
        SELECT t."tenant_id"
          INTO v_tenant_id
          FROM public."tenants" AS t
         WHERE t."room_id" = v_room_id
           AND t."is_active" = 1
           AND (
               (v_requested_by IS NOT NULL AND t."user_id" = v_requested_by)
               OR EXISTS (
                   SELECT 1
                     FROM public."bookings" AS booking_for_email
                    WHERE booking_for_email."booking_id" = v_booking_id
                      AND NULLIF(btrim(t."email"), '') IS NOT NULL
                      AND lower(btrim(t."email")) = lower(btrim(booking_for_email."email"))
               )
           )
         ORDER BY CASE WHEN t."user_id" = v_requested_by THEN 0 ELSE 1 END,
                  t."tenant_id" DESC
         LIMIT 1
         FOR UPDATE OF t;
        IF v_tenant_id IS NULL THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'No active tenant record was found for this booking.');
        END IF;

        UPDATE public."bookings"
           SET "check_out_date" = v_requested_checkout,
               "length_of_stay_months" = v_new_length_months,
               "total_rent" = v_new_total,
               "updated_at" = CURRENT_TIMESTAMP
         WHERE "booking_id" = v_booking_id;

        UPDATE public."tenants"
           SET "move_out_date" = v_requested_checkout
         WHERE "tenant_id" = v_tenant_id
           AND "is_active" = 1;

        IF v_payment_plan = 'Pay in Full' THEN
            INSERT INTO public."payments" (
                "booking_id", "tenant_id", "amount", "due_date", "status",
                "description", "payment_type", "created_at"
            )
            VALUES (
                v_booking_id, v_tenant_id, v_applicable_charge, v_original_checkout,
                'Pending', 'Extended stay rent', 'Extension', CURRENT_TIMESTAMP
            );
        ELSE
            FOR v_month_index IN v_length_months..(v_new_length_months - 1) LOOP
                v_month_start := date_trunc(
                    'month',
                    v_check_in + make_interval(months => v_month_index)
                )::date;
                v_due_date := v_month_start + (
                    LEAST(
                        EXTRACT(DAY FROM v_check_in)::integer,
                        EXTRACT(DAY FROM (v_month_start + interval '1 month - 1 day'))::integer
                    ) - 1
                );
                EXIT WHEN v_due_date >= v_requested_checkout;
                IF NOT EXISTS (
                    SELECT 1 FROM public."payments" AS existing_payment
                     WHERE existing_payment."booking_id" = v_booking_id
                       AND existing_payment."due_date" = v_due_date
                ) THEN
                    INSERT INTO public."payments" (
                        "booking_id", "tenant_id", "amount", "due_date", "status",
                        "description", "payment_type", "created_at"
                    )
                    VALUES (
                        v_booking_id, v_tenant_id, v_monthly_rent, v_due_date,
                        'Pending', 'Monthly rent installment ' || (v_month_index + 1),
                        v_payment_plan, CURRENT_TIMESTAMP
                    );
                END IF;
            END LOOP;
        END IF;
    END IF;

    UPDATE public."stay_change_requests"
       SET "status" = v_decision,
           "applicable_charge" = v_applicable_charge,
           "acted_by" = app_user_id,
           "acted_at" = CURRENT_TIMESTAMP
     WHERE "request_id" = v_request_id
       AND "status" = 'Pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Could not save the extension decision.';
    END IF;

    RETURN jsonb_build_object(
        'type', 'success',
        'message', CASE WHEN v_decision = 'Approved'
            THEN 'Extension approved and rent schedule updated.'
            ELSE 'Extension request rejected.'
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.manage_stay_extension(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_stay_extension(text, uuid, jsonb) TO service_role;
