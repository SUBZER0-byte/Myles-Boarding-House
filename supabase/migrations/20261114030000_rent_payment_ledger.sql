CREATE OR REPLACE FUNCTION public.rent_add_months(p_date date, p_months integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT make_date(
        extract(year FROM shifted)::integer,
        extract(month FROM shifted)::integer,
        least(
            extract(day FROM p_date)::integer,
            extract(day FROM (date_trunc('month', shifted) + interval '1 month - 1 day'))::integer
        )
    )
      FROM (SELECT p_date + make_interval(months => p_months) AS shifted) AS dates
$$;

CREATE OR REPLACE FUNCTION public.ensure_tenant_rent_schedule(p_tenant_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    booking_row record;
    check_in date;
    check_out date;
    monthly_rent numeric(10,2);
    month_total integer;
    installment_total integer;
    installment_index integer;
    due_date_value date;
    period_start date;
    period_end date;
    amount_value numeric(10,2);
    description_value text;
    plan_value text;
    booking_id_value integer;
    existing_payment_id integer;
    payment_count integer := 0;
BEGIN
    IF p_tenant_id IS NULL OR p_tenant_id <= 0 THEN
        RAISE EXCEPTION 'A valid tenant is required';
    END IF;

    PERFORM pg_advisory_xact_lock(761010, p_tenant_id);

    FOR booking_row IN
        SELECT b."booking_id",
               COALESCE(b."move_in_date", t."move_in_date") AS "move_in_date",
               COALESCE(b."check_out_date", t."move_out_date") AS "check_out_date",
               COALESCE(b."payment_plan", 'Pay Monthly') AS "payment_plan",
               COALESCE(booked_room."monthly_rent", tenant_room."monthly_rent") AS "monthly_rent"
          FROM public."tenants" AS t
          LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
          LEFT JOIN public."bookings" AS b
            ON (
                (NULLIF(btrim(t."email"), '') IS NOT NULL AND lower(btrim(t."email")) = lower(btrim(b."email")))
                OR (NULLIF(btrim(u."email"), '') IS NOT NULL AND lower(btrim(u."email")) = lower(btrim(b."email")))
                OR (t."move_in_date" = b."move_in_date"
                    AND lower(btrim(t."full_name")) = lower(btrim(b."full_name"))
                    AND t."phone" = b."phone")
            )
           AND b."status" <> 'Cancelled'
          LEFT JOIN public."rooms" AS booked_room ON booked_room."room_id" = b."room_id"
          LEFT JOIN public."rooms" AS tenant_room ON tenant_room."room_id" = t."room_id"
         WHERE t."tenant_id" = p_tenant_id
           AND t."is_active" = 1
           AND COALESCE(b."move_in_date", t."move_in_date") IS NOT NULL
           AND COALESCE(b."check_out_date", t."move_out_date") IS NOT NULL
         ORDER BY b."move_in_date" ASC NULLS LAST, b."booking_id" ASC NULLS LAST
    LOOP
        check_in := booking_row."move_in_date";
        check_out := booking_row."check_out_date";
        monthly_rent := COALESCE(booking_row."monthly_rent", 0);
        booking_id_value := booking_row."booking_id";
        plan_value := COALESCE(booking_row."payment_plan", 'Pay Monthly');

        IF check_in IS NULL OR check_out IS NULL OR check_out <= check_in OR monthly_rent <= 0 THEN
            CONTINUE;
        END IF;

        month_total := greatest(
            1,
            ((extract(year FROM check_out)::integer - extract(year FROM check_in)::integer) * 12)
             + extract(month FROM check_out)::integer - extract(month FROM check_in)::integer
             + CASE WHEN extract(day FROM check_out) > extract(day FROM check_in) THEN 1 ELSE 0 END
        );
        installment_total := CASE
            WHEN plan_value = 'Pay in Full' THEN 1
            WHEN plan_value = 'Pay One Month Rent' THEN month_total
            ELSE greatest(1, month_total - 1)
        END;

        IF plan_value <> 'Pay in Full' AND installment_total > 1 AND booking_id_value IS NOT NULL
           AND EXISTS (
               SELECT 1 FROM public."payments" AS deposit
                WHERE deposit."booking_id" = booking_id_value
                  AND deposit."payment_type" = 'Security Deposit'
                  AND deposit."status" IN ('Confirmed', 'Paid')
           ) THEN
            due_date_value := public.rent_add_months(check_in, installment_total);
            UPDATE public."payments"
               SET "status" = 'Cancelled',
                   "description" = 'Final month covered by security deposit'
             WHERE "booking_id" = booking_id_value
               AND "due_date" = due_date_value
               AND "payment_type" <> 'Security Deposit'
               AND "status" IN ('Pending', 'Overdue');
        END IF;

        FOR installment_index IN 0..(installment_total - 1) LOOP
            due_date_value := public.rent_add_months(check_in, installment_index);
            EXIT WHEN due_date_value >= check_out;

            existing_payment_id := NULL;
            IF booking_id_value IS NOT NULL THEN
                SELECT p."payment_id" INTO existing_payment_id
                  FROM public."payments" AS p
                 WHERE p."booking_id" = booking_id_value AND p."due_date" = due_date_value
                 ORDER BY p."payment_id"
                 LIMIT 1;
            ELSE
                SELECT p."payment_id" INTO existing_payment_id
                  FROM public."payments" AS p
                 WHERE p."tenant_id" = p_tenant_id
                   AND p."booking_id" IS NULL
                   AND p."due_date" = due_date_value
                 ORDER BY p."payment_id"
                 LIMIT 1;
            END IF;

            IF existing_payment_id IS NOT NULL THEN
                UPDATE public."payments"
                   SET "tenant_id" = p_tenant_id
                 WHERE "payment_id" = existing_payment_id
                   AND "tenant_id" IS DISTINCT FROM p_tenant_id;
                CONTINUE;
            END IF;

            period_start := date_trunc('month', due_date_value)::date;
            period_end := (date_trunc('month', due_date_value) + interval '1 month - 1 day')::date;
            SELECT p."payment_id" INTO existing_payment_id
              FROM public."payments" AS p
             WHERE p."tenant_id" = p_tenant_id
               AND p."booking_id" IS NULL
               AND p."due_date" BETWEEN period_start AND period_end
             ORDER BY p."payment_id"
             LIMIT 1;

            amount_value := CASE
                WHEN plan_value = 'Pay in Full' THEN greatest(0, round(monthly_rent * month_total - monthly_rent, 2))
                ELSE monthly_rent
            END;
            description_value := CASE
                WHEN plan_value = 'Pay in Full' THEN 'Full stay rent after security deposit credit'
                ELSE 'Monthly rent installment ' || (installment_index + 1)::text
            END;

            IF existing_payment_id IS NOT NULL THEN
                UPDATE public."payments"
                   SET "booking_id" = booking_id_value,
                       "due_date" = due_date_value,
                       "amount" = amount_value,
                       "description" = description_value,
                       "payment_type" = plan_value
                 WHERE "payment_id" = existing_payment_id;
            ELSE
                INSERT INTO public."payments" (
                    "booking_id", "tenant_id", "amount", "due_date", "status",
                    "description", "payment_type", "created_at"
                ) VALUES (
                    booking_id_value, p_tenant_id, amount_value, due_date_value, 'Pending',
                    description_value, plan_value, CURRENT_TIMESTAMP
                );
            END IF;
            payment_count := payment_count + 1;
        END LOOP;
    END LOOP;

    RETURN payment_count;
END;
$$;

REVOKE ALL ON FUNCTION public.rent_add_months(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_tenant_rent_schedule(integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.manage_rent_ledger(
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
    tenant_id_value integer;
    payment_id_value integer;
    payment_row public."payments"%ROWTYPE;
    reference_value text;
    proof_path text;
    status_value text;
    method_value text;
    result jsonb;
    generated_count integer := 0;
    tenant_row record;
    anchor_date date;
    due_date_value date;
    amount_value numeric(10,2);
    description_value text;
    reserved_reference text;
BEGIN
    actor_id := public.current_app_user_id();
    actor_role := public.current_app_user_role();
    IF actor_id IS NULL OR actor_role IS NULL THEN
        RAISE EXCEPTION 'An active authenticated account is required';
    END IF;

    IF p_action LIKE 'admin_%' AND actor_role <> 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_action LIKE 'tenant_%' AND actor_role <> 'Tenant' THEN
        RAISE EXCEPTION 'Tenant access is required';
    END IF;

    IF p_action = 'tenant_history' THEN
        SELECT t."tenant_id" INTO tenant_id_value
          FROM public."tenants" AS t
         WHERE t."user_id" = actor_id AND t."is_active" = 1
         ORDER BY t."tenant_id"
         LIMIT 1;
        IF tenant_id_value IS NULL THEN RAISE EXCEPTION 'An active tenant account is required'; END IF;
        PERFORM public.ensure_tenant_rent_schedule(tenant_id_value);

        SELECT COALESCE(jsonb_agg(row_data ORDER BY due_date DESC NULLS LAST, payment_id DESC), '[]'::jsonb)
          INTO result
          FROM (
              SELECT p."due_date", p."payment_id",
                     jsonb_build_object(
                         'payment_id', p."payment_id",
                         'amount', p."amount",
                         'due_date', p."due_date",
                         'paid_at', p."paid_at",
                         'status', p."status",
                         'method', p."method",
                         'description', p."description",
                         'reference_number', p."reference_number",
                         'has_payment_screenshot', (proof."payment_id" IS NOT NULL),
                         'screenshot_path', proof."screenshot_path",
                         'refunded_amount', COALESCE((
                             SELECT sum(rr."refund_amount")
                               FROM public."refund_requests" AS rr
                              WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
                         ), 0),
                         'refund_available', (
                             p."status" IN ('Confirmed', 'Paid')
                             AND p."due_date" IS NOT NULL
                             AND CURRENT_DATE < least(
                                 public.rent_add_months(p."due_date", 1),
                                 COALESCE(b."check_out_date", t."move_out_date", public.rent_add_months(p."due_date", 1))
                             )
                             AND p."amount" > COALESCE((
                                 SELECT sum(rr."refund_amount")
                                   FROM public."refund_requests" AS rr
                                  WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
                             ), 0)
                             AND NOT EXISTS (
                                 SELECT 1 FROM public."refund_requests" AS rr
                                  WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Pending'
                             )
                         ),
                         'check_in_date', COALESCE(b."move_in_date", t."move_in_date"),
                         'check_out_date', COALESCE(
                             b."check_out_date",
                             t."move_out_date",
                             (
                                 SELECT matched."check_out_date"
                                   FROM public."bookings" AS matched
                                  WHERE matched."status" <> 'Cancelled'
                                    AND (
                                        (NULLIF(btrim(t."email"), '') IS NOT NULL AND lower(btrim(matched."email")) = lower(btrim(t."email")))
                                        OR (NULLIF(btrim(u."email"), '') IS NOT NULL AND lower(btrim(matched."email")) = lower(btrim(u."email")))
                                        OR (t."move_in_date" = matched."move_in_date"
                                            AND t."phone" = matched."phone"
                                            AND lower(btrim(t."full_name")) = lower(btrim(matched."full_name")))
                                    )
                                  ORDER BY matched."created_at" DESC
                                  LIMIT 1
                             )
                         )
                     ) AS row_data
                FROM public."payments" AS p
                LEFT JOIN public."bookings" AS b ON b."booking_id" = p."booking_id"
                LEFT JOIN public."tenants" AS t ON t."tenant_id" = p."tenant_id"
                LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
                LEFT JOIN public."payment_proofs" AS proof ON proof."payment_id" = p."payment_id"
               WHERE p."tenant_id" = tenant_id_value
          ) AS history;
        RETURN jsonb_build_object('type', 'success', 'data', COALESCE(result, '[]'::jsonb));

    ELSIF p_action = 'tenant_submit' THEN
        IF COALESCE(p_data->>'payment_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'A valid payment is required';
        END IF;
        payment_id_value := (p_data->>'payment_id')::integer;
        reference_value := NULLIF(btrim(p_data->>'reference'), '');
        proof_path := NULLIF(p_data->>'screenshot_path', '');
        IF length(COALESCE(reference_value, '')) > 120 OR (reference_value IS NULL AND proof_path IS NULL) THEN
            RAISE EXCEPTION 'Enter a GCash transaction reference or upload a payment screenshot';
        END IF;

        SELECT t."tenant_id" INTO tenant_id_value
          FROM public."tenants" AS t
         WHERE t."user_id" = actor_id AND t."is_active" = 1
         ORDER BY t."tenant_id"
         LIMIT 1;
        IF tenant_id_value IS NULL THEN RAISE EXCEPTION 'An active tenant account is required'; END IF;
        SELECT p.* INTO payment_row
          FROM public."payments" AS p
         WHERE p."payment_id" = payment_id_value AND p."tenant_id" = tenant_id_value
         FOR UPDATE;
        IF payment_row."payment_id" IS NULL THEN RAISE EXCEPTION 'Payment not found or access denied'; END IF;

        IF payment_row."status" = 'Submitted'
           AND payment_row."method" = 'GCash'
           AND COALESCE(payment_row."reference_number", '') = COALESCE(reference_value, '')
           AND (
               proof_path IS NULL
               OR EXISTS (
                   SELECT 1 FROM public."payment_proofs" AS proof
                    WHERE proof."payment_id" = payment_id_value AND proof."screenshot_path" = proof_path
               )
           ) THEN
            RETURN jsonb_build_object('type', 'success', 'message', 'GCash payment is already submitted for admin review', 'data', NULL);
        END IF;
        IF payment_row."status" NOT IN ('Pending', 'Overdue') THEN
            RAISE EXCEPTION 'This payment is not awaiting payment';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public."gcash_qr_codes" AS qr
             WHERE qr."amount" = round(payment_row."amount", 2)
               AND qr."filename" ~ '^gcash-qr/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
               AND EXISTS (
                   SELECT 1 FROM storage.objects
                    WHERE bucket_id = 'mbh-payment-qrs' AND name = qr."filename"
               )
        ) THEN
            RAISE EXCEPTION 'No GCash QR is configured for this rent amount';
        END IF;
        IF EXISTS (
            SELECT 1 FROM public."full_payment_request_items" AS item
            JOIN public."full_payment_requests" AS request USING ("request_id")
             WHERE item."payment_id" = payment_id_value
               AND request."tenant_id" = tenant_id_value
               AND request."status" IN ('Requested', 'Approved', 'Submitted')
        ) THEN
            RAISE EXCEPTION 'This installment is part of your full payment request';
        END IF;
        IF proof_path IS NOT NULL THEN
            IF proof_path !~ ('^' || auth.uid()::text || '/rent-payment/' || payment_id_value::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$')
               OR NOT EXISTS (
                   SELECT 1 FROM storage.objects
                    WHERE bucket_id = 'mbh-financial-evidence' AND name = proof_path
               ) THEN
                RAISE EXCEPTION 'Payment screenshot upload was not found or is invalid';
            END IF;
        END IF;

        IF reference_value IS NOT NULL THEN
            IF EXISTS (
                SELECT 1 FROM public."gcash_transaction_references" AS used
                 WHERE used."reference_number" = reference_value
                UNION ALL
                SELECT 1 FROM public."payments" AS used
                 WHERE used."reference_number" = reference_value
                UNION ALL
                SELECT 1 FROM public."booking_initial_payment_requests" AS used
                 WHERE used."reference_number" = reference_value
                UNION ALL
                SELECT 1 FROM public."full_payment_requests" AS used
                 WHERE used."reference_number" = reference_value
                UNION ALL
                SELECT 1 FROM public."refund_requests" AS used
                 WHERE used."transaction_reference" = reference_value
                    OR used."transfer_reference" = reference_value
            ) THEN
                RAISE EXCEPTION 'This GCash reference has already been submitted';
            END IF;
            INSERT INTO public."gcash_transaction_references" ("reference_number")
            VALUES (reference_value)
            ON CONFLICT ("reference_number") DO NOTHING;
            IF NOT FOUND THEN RAISE EXCEPTION 'This GCash reference has already been submitted'; END IF;
        END IF;

        UPDATE public."payments"
           SET "tenant_id" = tenant_id_value,
               "status" = 'Submitted',
               "method" = 'GCash',
               "reference_number" = reference_value,
               "submitted_at" = COALESCE("submitted_at", CURRENT_TIMESTAMP)
         WHERE "payment_id" = payment_id_value;
        IF proof_path IS NOT NULL THEN
            INSERT INTO public."payment_proofs" ("payment_id", "screenshot_path", "uploaded_at")
            VALUES (payment_id_value, proof_path, CURRENT_TIMESTAMP)
            ON CONFLICT ("payment_id") DO UPDATE
                SET "screenshot_path" = EXCLUDED."screenshot_path",
                    "uploaded_at" = EXCLUDED."uploaded_at";
        END IF;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT u."user_id", 'Rent Payment Needs Review',
               'Tenant #' || tenant_id_value || ' submitted a GCash rent payment of PHP '
                   || to_char(payment_row."amount", 'FM999999990.00') || ' for admin review.',
               'payment'
          FROM public."users" AS u
         WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
        RETURN jsonb_build_object('type', 'success', 'message', 'GCash payment submitted for admin review', 'data', NULL);

    ELSIF p_action = 'admin_tenants' THEN
        SELECT COALESCE(jsonb_agg(row_data ORDER BY is_active DESC, full_name), '[]'::jsonb)
          INTO result
          FROM (
              SELECT t."is_active", t."full_name",
                     jsonb_build_object(
                         'tenant_id', t."tenant_id",
                         'full_name', t."full_name",
                         'email', t."email",
                         'move_in_date', COALESCE((
                             SELECT b."move_in_date" FROM public."bookings" AS b
                             LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
                              WHERE b."status" <> 'Cancelled'
                                AND (
                                    (NULLIF(btrim(t."email"), '') IS NOT NULL AND lower(btrim(t."email")) = lower(btrim(b."email")))
                                    OR (NULLIF(btrim(u."email"), '') IS NOT NULL AND lower(btrim(u."email")) = lower(btrim(b."email")))
                                    OR (t."move_in_date" = b."move_in_date"
                                        AND lower(btrim(t."full_name")) = lower(btrim(b."full_name"))
                                        AND t."phone" = b."phone")
                                )
                              ORDER BY b."created_at" DESC LIMIT 1
                         ), t."move_in_date"),
                         'move_out_date', COALESCE((
                             SELECT b."check_out_date" FROM public."bookings" AS b
                             LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
                              WHERE b."status" <> 'Cancelled'
                                AND (
                                    (NULLIF(btrim(t."email"), '') IS NOT NULL AND lower(btrim(t."email")) = lower(btrim(b."email")))
                                    OR (NULLIF(btrim(u."email"), '') IS NOT NULL AND lower(btrim(u."email")) = lower(btrim(b."email")))
                                    OR (t."move_in_date" = b."move_in_date"
                                        AND lower(btrim(t."full_name")) = lower(btrim(b."full_name"))
                                        AND t."phone" = b."phone")
                                )
                              ORDER BY b."created_at" DESC LIMIT 1
                         ), t."move_out_date"),
                         'is_active', t."is_active",
                         'room_number', r."room_number"
                     ) AS row_data
                FROM public."tenants" AS t
                LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
          ) AS tenants;
        RETURN jsonb_build_object('type', 'success', 'data', COALESCE(result, '[]'::jsonb));

    ELSIF p_action = 'admin_list' THEN
        tenant_id_value := NULLIF(p_data->>'tenant_id', '')::integer;
        IF tenant_id_value IS NOT NULL THEN
            PERFORM public.ensure_tenant_rent_schedule(tenant_id_value);
        ELSE
            PERFORM public.manage_rent_ledger('admin_generate_next_month', '{}'::jsonb);
        END IF;
        SELECT COALESCE(jsonb_agg(row_data ORDER BY due_date ASC NULLS LAST, payment_id ASC), '[]'::jsonb)
          INTO result
          FROM (
              SELECT p."due_date", p."payment_id",
                     jsonb_build_object(
                         'payment_id', p."payment_id",
                         'tenant_id', p."tenant_id",
                         'full_name', t."full_name",
                         'room_number', r."room_number",
                         'amount', p."amount",
                         'due_date', p."due_date",
                         'paid_at', p."paid_at",
                         'method', p."method",
                         'reference_number', p."reference_number",
                         'has_payment_screenshot', (proof."payment_id" IS NOT NULL),
                         'screenshot_path', proof."screenshot_path",
                         'status', p."status",
                         'display_status', CASE WHEN p."status" = 'Pending' AND p."due_date" < CURRENT_DATE THEN 'Overdue' ELSE p."status" END,
                         'description', p."description"
                     ) AS row_data
                FROM public."payments" AS p
                JOIN public."tenants" AS t ON t."tenant_id" = p."tenant_id"
                LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
                LEFT JOIN public."payment_proofs" AS proof ON proof."payment_id" = p."payment_id"
               WHERE (tenant_id_value IS NULL OR p."tenant_id" = tenant_id_value)
                 AND (
                     NULLIF(p_data->>'status', '') IS NULL
                     OR (CASE WHEN p."status" = 'Pending' AND p."due_date" < CURRENT_DATE THEN 'Overdue' ELSE p."status" END) = p_data->>'status'
                 )
          ) AS rows;
        RETURN jsonb_build_object('type', 'success', 'data', COALESCE(result, '[]'::jsonb));

    ELSIF p_action = 'admin_summary' THEN
        tenant_id_value := NULLIF(p_data->>'tenant_id', '')::integer;
        SELECT COALESCE(jsonb_agg(row_data ORDER BY status), '[]'::jsonb)
          INTO result
          FROM (
              SELECT CASE WHEN p."status" = 'Pending' AND p."due_date" < CURRENT_DATE THEN 'Overdue' ELSE p."status" END AS status,
                     jsonb_build_object(
                         'status', CASE WHEN p."status" = 'Pending' AND p."due_date" < CURRENT_DATE THEN 'Overdue' ELSE p."status" END,
                         'cnt', count(*),
                         'total', COALESCE(sum(p."amount"), 0)
                     ) AS row_data
                FROM public."payments" AS p
               WHERE tenant_id_value IS NULL OR p."tenant_id" = tenant_id_value
               GROUP BY 1
          ) AS summary_rows;
        RETURN jsonb_build_object('type', 'success', 'data', COALESCE(result, '[]'::jsonb));

    ELSIF p_action = 'admin_create' THEN
        IF COALESCE(p_data->>'tenant_id', '') !~ '^[1-9][0-9]{0,9}$'
           OR COALESCE(p_data->>'amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
           OR COALESCE(p_data->>'due_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RAISE EXCEPTION 'Enter a valid tenant, amount, and due date';
        END IF;
        tenant_id_value := (p_data->>'tenant_id')::integer;
        amount_value := (p_data->>'amount')::numeric(10,2);
        status_value := COALESCE(NULLIF(p_data->>'status', ''), 'Pending');
        description_value := COALESCE(p_data->>'description', '');
        IF amount_value <= 0 OR status_value NOT IN ('Pending', 'Paid', 'Overdue') OR length(description_value) > 255
           OR NOT EXISTS (SELECT 1 FROM public."tenants" WHERE "tenant_id" = tenant_id_value) THEN
            RAISE EXCEPTION 'Invalid rent payment details';
        END IF;
        INSERT INTO public."payments" ("tenant_id", "amount", "due_date", "status", "description", "created_at")
        VALUES (tenant_id_value, amount_value, (p_data->>'due_date')::date, status_value, description_value, CURRENT_TIMESTAMP)
        RETURNING "payment_id" INTO payment_id_value;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT t."user_id", 'Rent Payment Added',
               'A rent payment of PHP ' || to_char(amount_value, 'FM999999990.00') || ' is due on ' || (p_data->>'due_date') || '.',
               'payment'
          FROM public."tenants" AS t
         WHERE t."tenant_id" = tenant_id_value AND t."user_id" IS NOT NULL;
        RETURN jsonb_build_object('type', 'success', 'message', 'Payment created', 'data', jsonb_build_object('payment_id', payment_id_value));

    ELSIF p_action = 'admin_update_status' THEN
        IF COALESCE(p_data->>'payment_id', '') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'A valid payment is required'; END IF;
        payment_id_value := (p_data->>'payment_id')::integer;
        status_value := COALESCE(NULLIF(p_data->>'status', ''), 'Paid');
        method_value := COALESCE(NULLIF(p_data->>'method', ''), 'Cash');
        reference_value := btrim(COALESCE(p_data->>'reference', ''));
        IF status_value NOT IN ('Pending', 'Overdue', 'Submitted', 'Paid', 'Rejected') THEN RAISE EXCEPTION 'Invalid payment status'; END IF;
        IF status_value = 'Paid' AND method_value NOT IN ('Cash', 'GCash') THEN RAISE EXCEPTION 'Payment method must be Cash or GCash'; END IF;
        IF length(reference_value) > 120 THEN RAISE EXCEPTION 'Payment reference must be 120 characters or fewer'; END IF;

        SELECT p.* INTO payment_row FROM public."payments" AS p
         WHERE p."payment_id" = payment_id_value AND p."status" <> 'Cancelled'
         FOR UPDATE;
        IF payment_row."payment_id" IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
        IF status_value = 'Paid' AND method_value = 'GCash'
           AND reference_value = ''
           AND NOT EXISTS (SELECT 1 FROM public."payment_proofs" WHERE "payment_id" = payment_id_value) THEN
            RAISE EXCEPTION 'Enter a GCash transaction number or verify an uploaded screenshot';
        END IF;
        IF status_value = 'Paid' AND method_value = 'GCash' AND reference_value <> ''
           AND reference_value IS DISTINCT FROM COALESCE(payment_row."reference_number", '') THEN
            IF EXISTS (
                SELECT 1 FROM public."gcash_transaction_references" AS used
                 WHERE used."reference_number" = reference_value
                UNION ALL
                SELECT 1 FROM public."payments" AS used
                 WHERE used."reference_number" = reference_value
                UNION ALL
                SELECT 1 FROM public."booking_initial_payment_requests" AS used
                 WHERE used."reference_number" = reference_value
                UNION ALL
                SELECT 1 FROM public."full_payment_requests" AS used
                 WHERE used."reference_number" = reference_value
                UNION ALL
                SELECT 1 FROM public."refund_requests" AS used
                 WHERE used."transaction_reference" = reference_value
                    OR used."transfer_reference" = reference_value
            ) THEN
                RAISE EXCEPTION 'This GCash reference has already been submitted';
            END IF;
            INSERT INTO public."gcash_transaction_references" ("reference_number")
            VALUES (reference_value)
            ON CONFLICT ("reference_number") DO NOTHING;
            IF NOT FOUND THEN RAISE EXCEPTION 'This GCash reference has already been submitted'; END IF;
        END IF;
        IF status_value = 'Paid' THEN
            UPDATE public."payments"
               SET "status" = 'Paid',
                   "submitted_at" = COALESCE("submitted_at", CURRENT_TIMESTAMP),
                   "paid_at" = COALESCE("paid_at", CURRENT_TIMESTAMP),
                   "method" = method_value,
                   "reference_number" = reference_value
             WHERE "payment_id" = payment_id_value;
            IF payment_row."status" NOT IN ('Paid', 'Confirmed') THEN
                INSERT INTO public."notifications" ("user_id", "title", "message", "type")
                SELECT t."user_id", 'Rent Payment Received',
                       'Your rent payment of PHP ' || to_char(payment_row."amount", 'FM999999990.00') || ' has been recorded as paid.',
                       'payment'
                  FROM public."tenants" AS t
                 WHERE t."tenant_id" = payment_row."tenant_id" AND t."user_id" IS NOT NULL;
            END IF;
            RETURN jsonb_build_object('type', 'success', 'message', 'Payment marked as paid', 'data', NULL);
        END IF;

        UPDATE public."payments"
           SET "status" = status_value, "paid_at" = NULL
         WHERE "payment_id" = payment_id_value;
        RETURN jsonb_build_object('type', 'success', 'message', 'Payment status updated', 'data', NULL);

    ELSIF p_action = 'admin_delete' THEN
        IF COALESCE(p_data->>'payment_id', '') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'A valid payment is required'; END IF;
        payment_id_value := (p_data->>'payment_id')::integer;
        DELETE FROM public."payments" WHERE "payment_id" = payment_id_value;
        IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
        RETURN jsonb_build_object('type', 'success', 'message', 'Deleted', 'data', NULL);

    ELSIF p_action = 'admin_generate_next_month' THEN
        FOR tenant_row IN
            SELECT t."tenant_id", t."user_id", r."monthly_rent", t."phone", t."email"
              FROM public."tenants" AS t
              LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
              LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
             WHERE t."is_active" = 1
        LOOP
            PERFORM pg_advisory_xact_lock(761011, tenant_row."tenant_id");
            amount_value := COALESCE(tenant_row."monthly_rent", 0);
            IF amount_value <= 0 THEN CONTINUE; END IF;
            SELECT min(b."created_at")::date INTO anchor_date
              FROM public."bookings" AS b
             WHERE b."created_at" IS NOT NULL
               AND (
                   (NULLIF(btrim(tenant_row."phone"), '') IS NOT NULL AND b."phone" = tenant_row."phone")
                   OR (NULLIF(btrim(tenant_row."email"), '') IS NOT NULL AND lower(btrim(b."email")) = lower(btrim(tenant_row."email")))
               );
            IF anchor_date IS NULL THEN CONTINUE; END IF;
            due_date_value := public.rent_add_months(anchor_date, 1);
            IF EXISTS (
                SELECT 1 FROM public."payments" AS p
                 WHERE p."tenant_id" = tenant_row."tenant_id" AND p."due_date" = due_date_value
            ) THEN CONTINUE; END IF;
            description_value := 'Rent for ' || to_char(due_date_value, 'FMMonth YYYY');
            INSERT INTO public."payments" ("tenant_id", "amount", "due_date", "status", "description", "created_at")
            VALUES (tenant_row."tenant_id", amount_value, due_date_value, 'Pending', description_value, CURRENT_TIMESTAMP);
            generated_count := generated_count + 1;
            IF tenant_row."user_id" IS NOT NULL THEN
                INSERT INTO public."notifications" ("user_id", "title", "message", "type")
                VALUES (
                    tenant_row."user_id",
                    'Upcoming Rent Payment',
                    'Your rent payment of PHP ' || to_char(amount_value, 'FM999999990.00') || ' is due on ' || due_date_value::text || '.',
                    'payment'
                );
            END IF;
        END LOOP;
        RETURN jsonb_build_object(
            'type', 'success',
            'message', CASE WHEN generated_count > 0
                THEN 'Generated ' || generated_count::text || ' next-month rent payment(s).'
                ELSE 'No new next-month rent payment was needed.' END,
            'data', jsonb_build_object('count', generated_count)
        );
    END IF;

    RAISE EXCEPTION 'Invalid rent ledger action';
END;
$$;

REVOKE ALL ON FUNCTION public.manage_rent_ledger(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_rent_ledger(text, jsonb) TO authenticated;
