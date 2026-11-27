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

REVOKE ALL ON FUNCTION public.rent_add_months(date, integer) FROM PUBLIC, anon, authenticated;

DO $migration$
DECLARE
    function_definition text;
    old_fragment text;
    new_fragment text;
    advance_field text;
    amount_due_position integer;
    marker_position integer;
BEGIN
    SELECT pg_get_functiondef('public.manage_guest_booking(text,jsonb)'::regprocedure)
      INTO function_definition;

    old_fragment := 'check_out_value < move_in_value + 30 OR mod(check_out_value - move_in_value, 30) <> 0';
    IF strpos(function_definition, old_fragment) > 0 THEN
        function_definition := replace(
            function_definition,
            old_fragment,
            'check_out_value < (move_in_value + interval ''1 month'')::date'
        );
    ELSIF strpos(function_definition, 'check_out_value < (move_in_value + interval ''1 month'')::date') = 0 THEN
        RAISE EXCEPTION 'Could not locate guest booking stay validation to update.';
    END IF;

    old_fragment := 'Choose a stay in 30-day periods of at least 30 days';
    IF strpos(function_definition, old_fragment) > 0 THEN
        function_definition := replace(
            function_definition,
            old_fragment,
            'Choose a valid stay of at least one month'
        );
    ELSIF strpos(function_definition, 'Choose a valid stay of at least one month') = 0 THEN
        RAISE EXCEPTION 'Could not locate guest booking validation message to update.';
    END IF;

    old_fragment := 'stay_months := (check_out_value - move_in_value) / 30;';
    new_fragment := $months$
stay_months := ((extract(year FROM check_out_value) - extract(year FROM move_in_value)) * 12
                        + extract(month FROM check_out_value) - extract(month FROM move_in_value))::integer
                       + CASE WHEN extract(day FROM check_out_value) > extract(day FROM move_in_value) THEN 1 ELSE 0 END;
stay_months := GREATEST(stay_months, 1);
$months$;
    IF strpos(function_definition, old_fragment) > 0 THEN
        function_definition := replace(
            function_definition,
            old_fragment,
            new_fragment
        );
    ELSIF strpos(function_definition, 'stay_months := GREATEST(stay_months, 1);') = 0 THEN
        RAISE EXCEPTION 'Could not locate guest booking stay-month calculation.';
    END IF;

    old_fragment := 'stay_months := GREATEST(stay_months, 1);';
    marker_position := strpos(function_definition, old_fragment);
    IF marker_position = 0 THEN
        RAISE EXCEPTION 'Could not locate guest booking minimum stay calculation.';
    END IF;
    IF strpos(function_definition, 'check_out_value <> public.rent_add_months(move_in_value, stay_months)') = 0 THEN
        marker_position := marker_position + length(old_fragment) - 1;
        function_definition := substr(function_definition, 1, marker_position)
            || E'\n        IF check_out_value <> public.rent_add_months(move_in_value, stay_months) THEN\n'
            || E'            RAISE EXCEPTION ''Choose a valid stay in whole calendar-month increments'';\n'
            || E'        END IF;'
            || substr(function_definition, marker_position + 1);
    END IF;

    function_definition := regexp_replace(
        function_definition,
        $pattern$initial_amount := CASE p_data->>'payment_plan'[[:space:]]+WHEN 'Pay in Full' THEN total_rent_value[[:space:]]+WHEN 'Pay One Month Rent' THEN room_row\."monthly_rent"[[:space:]]+ELSE room_row\."monthly_rent" \* 2[[:space:]]+END;$pattern$,
        'initial_amount := round(room_row."monthly_rent" * 2, 2);',
        'g'
    );
    IF strpos(function_definition, 'initial_amount := round(room_row."monthly_rent" * 2, 2);') = 0 THEN
        RAISE EXCEPTION 'Could not locate guest booking initial-charge calculation to update.';
    END IF;

    IF strpos(function_definition, 'unconsumed_advance_amount') = 0 THEN
        IF strpos(function_definition, 'amount_paid') = 0 THEN
            RAISE EXCEPTION 'Could not locate guest booking payment totals to update.';
        END IF;
        amount_due_position := strpos(function_definition, '''amount_due''');
        IF amount_due_position = 0 THEN
            RAISE EXCEPTION 'Could not locate guest booking amount due to update.';
        END IF;
        advance_field := $field$
'unconsumed_advance_amount', COALESCE((
    SELECT sum(advance."amount" - COALESCE((
        SELECT sum(refund."refund_amount")
          FROM public."refund_requests" AS refund
         WHERE refund."payment_id" = advance."payment_id"
           AND refund."status" = 'Approved'
    ), 0))
      FROM public."payments" AS advance
     WHERE advance."booking_id" = b."booking_id"
       AND advance."payment_type" = 'Advance Rent'
       AND advance."status" IN ('Confirmed', 'Paid')
       AND advance."consumed_at" IS NULL
       AND NOT EXISTS (
           SELECT 1 FROM public."refund_requests" AS refund
            WHERE refund."payment_id" = advance."payment_id"
              AND refund."status" = 'Pending'
       )
), 0),
$field$;
        function_definition := substr(function_definition, 1, amount_due_position - 1)
            || advance_field
            || substr(function_definition, amount_due_position);
    END IF;
    EXECUTE function_definition;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.validate_stay_extension_calendar_months()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    extension_months integer;
BEGIN
    IF NEW."request_type" = 'Extension' THEN
        extension_months :=
            (extract(year FROM NEW."requested_check_out_date")::integer
             - extract(year FROM NEW."original_check_out_date")::integer) * 12
            + extract(month FROM NEW."requested_check_out_date")::integer
            - extract(month FROM NEW."original_check_out_date")::integer;
        IF NEW."original_check_out_date" IS NULL
           OR NEW."requested_check_out_date" IS NULL
           OR NEW."requested_check_out_date" <= NEW."original_check_out_date"
           OR extension_months < 1
           OR public.rent_add_months(NEW."original_check_out_date", extension_months)
                <> NEW."requested_check_out_date" THEN
            RAISE EXCEPTION 'Extensions must be requested in whole calendar-month periods.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_stay_extension_calendar_months() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stay_extension_validate_30_day_periods
    ON public."stay_change_requests";
DROP TRIGGER IF EXISTS stay_extension_validate_calendar_months
    ON public."stay_change_requests";
CREATE TRIGGER stay_extension_validate_calendar_months
    BEFORE INSERT OR UPDATE OF "original_check_out_date", "requested_check_out_date"
    ON public."stay_change_requests"
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_stay_extension_calendar_months();

CREATE OR REPLACE FUNCTION public.require_booking_advance_for_extension()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    advance_payment_id integer;
    monthly_rent numeric(10,2);
BEGIN
    IF NEW."request_type" <> 'Extension' OR NEW."status" <> 'Pending' THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(
               NULLIF(booking."total_rent" / NULLIF(booking."length_of_stay_months", 0), 0),
               room."monthly_rent"
           )
      INTO monthly_rent
      FROM public."bookings" AS booking
      JOIN public."rooms" AS room ON room."room_id" = booking."room_id"
     WHERE booking."booking_id" = NEW."booking_id";
    IF monthly_rent IS NULL OR monthly_rent <= 0 THEN
        RAISE EXCEPTION 'A valid monthly rent is required for this extension.';
    END IF;

    SELECT payment."payment_id"
      INTO advance_payment_id
      FROM public."payments" AS payment
      JOIN public."tenants" AS tenant ON tenant."tenant_id" = payment."tenant_id"
     WHERE payment."booking_id" = NEW."booking_id"
       AND payment."payment_type" = 'Advance Rent'
       AND payment."status" IN ('Confirmed', 'Paid')
       AND payment."consumed_at" IS NULL
       AND round(payment."amount" - COALESCE((
           SELECT sum(refund."refund_amount")
             FROM public."refund_requests" AS refund
            WHERE refund."payment_id" = payment."payment_id"
              AND refund."status" = 'Approved'
       ), 0), 2) = round(monthly_rent, 2)
       AND NOT EXISTS (
           SELECT 1 FROM public."refund_requests" AS refund
            WHERE refund."payment_id" = payment."payment_id"
              AND refund."status" = 'Pending'
       )
       AND tenant."is_active" = 1
     ORDER BY payment."due_date" NULLS FIRST, payment."payment_id"
     LIMIT 1
     FOR UPDATE OF payment;

    IF advance_payment_id IS NULL THEN
        RAISE EXCEPTION 'A confirmed, unused one-month advance with no pending refund is required to request an extension.';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_booking_advance_for_extension()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stay_extension_requires_available_advance
    ON public."stay_change_requests";
CREATE TRIGGER stay_extension_requires_available_advance
    BEFORE INSERT ON public."stay_change_requests"
    FOR EACH ROW
    EXECUTE FUNCTION public.require_booking_advance_for_extension();

CREATE OR REPLACE FUNCTION public.apply_booking_advance_to_extension()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    booking_row record;
    advance_row public."payments"%ROWTYPE;
    rent_payment_id integer;
    rent_payment_amount numeric(10,2);
    approved_refunds numeric(10,2);
BEGIN
    IF OLD."status" <> 'Pending'
       OR NEW."status" <> 'Approved'
       OR NEW."request_type" <> 'Extension' THEN
        RETURN NEW;
    END IF;

    SELECT booking."booking_id", booking."room_id",
           booking."move_in_date", booking."check_out_date", booking."payment_plan",
           booking."total_rent", booking."length_of_stay_months",
           COALESCE(
               NULLIF(booking."total_rent" / NULLIF(booking."length_of_stay_months", 0), 0),
               room."monthly_rent"
           ) AS monthly_rent,
           tenant."tenant_id"
      INTO booking_row
      FROM public."bookings" AS booking
      JOIN public."rooms" AS room ON room."room_id" = booking."room_id"
      JOIN public."tenants" AS tenant
        ON tenant."room_id" = booking."room_id"
       AND tenant."is_active" = 1
       AND (
           tenant."user_id" = NEW."requested_by"
           OR lower(btrim(tenant."email")) = lower(btrim(booking."email"))
       )
     WHERE booking."booking_id" = NEW."booking_id"
     ORDER BY CASE WHEN tenant."user_id" = NEW."requested_by" THEN 0 ELSE 1 END,
              tenant."tenant_id" DESC
     LIMIT 1;

    IF booking_row."tenant_id" IS NULL OR booking_row."monthly_rent" IS NULL
       OR booking_row."monthly_rent" <= 0 THEN
        RAISE EXCEPTION 'The active tenant or monthly rent for this extension could not be found.';
    END IF;

    SELECT payment.* INTO advance_row
      FROM public."payments" AS payment
     WHERE payment."booking_id" = NEW."booking_id"
       AND payment."payment_type" = 'Advance Rent'
       AND payment."status" IN ('Confirmed', 'Paid')
       AND payment."consumed_at" IS NULL
       AND round(payment."amount" - COALESCE((
           SELECT sum(refund."refund_amount")
             FROM public."refund_requests" AS refund
            WHERE refund."payment_id" = payment."payment_id"
              AND refund."status" = 'Approved'
       ), 0), 2) = round(booking_row."monthly_rent", 2)
       AND NOT EXISTS (
           SELECT 1 FROM public."refund_requests" AS refund
            WHERE refund."payment_id" = payment."payment_id"
              AND refund."status" = 'Pending'
       )
     ORDER BY payment."due_date" NULLS FIRST, payment."payment_id"
     LIMIT 1
     FOR UPDATE OF payment;

    IF advance_row."payment_id" IS NULL THEN
        RAISE EXCEPTION 'A confirmed, unused one-month advance with no pending refund is required to approve this extension.';
    END IF;

    SELECT COALESCE(sum(refund."refund_amount"), 0)::numeric(10,2)
      INTO approved_refunds
      FROM public."refund_requests" AS refund
     WHERE refund."payment_id" = advance_row."payment_id"
       AND refund."status" = 'Approved';
    IF round(advance_row."amount" - approved_refunds, 2) <> round(booking_row."monthly_rent", 2) THEN
        RAISE EXCEPTION 'The available booking advance must equal one full month of rent.';
    END IF;

    SELECT payment."payment_id", payment."amount"
      INTO rent_payment_id, rent_payment_amount
      FROM public."payments" AS payment
     WHERE payment."booking_id" = NEW."booking_id"
       AND payment."due_date" = NEW."original_check_out_date"
       AND COALESCE(payment."payment_type", '') NOT IN ('Security Deposit', 'Advance Rent')
       AND payment."status" IN ('Pending', 'Overdue')
     ORDER BY payment."payment_id"
     LIMIT 1
     FOR UPDATE;

    IF rent_payment_id IS NULL
       OR round(rent_payment_amount, 2) < round(booking_row."monthly_rent", 2) THEN
        RAISE EXCEPTION 'The first extension rent installment could not be credited with the booking advance.';
    END IF;

    IF round(rent_payment_amount - booking_row."monthly_rent", 2) = 0 THEN
        UPDATE public."payments"
           SET "status" = 'Cancelled',
               "description" = 'Extension rent installment covered by booking advance',
               "payment_type" = 'Advance Rent Applied',
               "method" = 'Booking Advance',
               "gateway" = 'internal',
               "reference_number" = advance_row."reference_number",
               "confirmation_date" = CURRENT_TIMESTAMP,
               "paid_at" = CURRENT_TIMESTAMP
         WHERE "payment_id" = rent_payment_id;
    ELSE
        UPDATE public."payments"
           SET "amount" = round(rent_payment_amount - booking_row."monthly_rent", 2),
               "description" = 'Extension rent balance after booking advance'
         WHERE "payment_id" = rent_payment_id;
    END IF;

    UPDATE public."payments"
       SET "consumed_at" = CURRENT_TIMESTAMP,
           "consumed_by_stay_change_request_id" = NEW."request_id",
           "description" = 'One-month advance rent applied to extension #' || NEW."request_id"
     WHERE "payment_id" = advance_row."payment_id";

    INSERT INTO public."payments" (
        "booking_id", "tenant_id", "amount", "due_date", "status",
        "description", "payment_type", "created_at"
    ) VALUES (
        NEW."booking_id", booking_row."tenant_id", booking_row."monthly_rent",
        NEW."original_check_out_date", 'Pending',
        'One-month advance required for extended stay', 'Advance Rent',
        CURRENT_TIMESTAMP
    );

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_booking_advance_to_extension()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stay_extension_apply_booking_advance
    ON public."stay_change_requests";
CREATE TRIGGER stay_extension_apply_booking_advance
    AFTER UPDATE OF "status" ON public."stay_change_requests"
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_booking_advance_to_extension();

CREATE OR REPLACE FUNCTION public.apply_booking_advance_to_overdue_rent(
    p_booking_id integer,
    p_tenant_id integer,
    p_monthly_rent numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    advance_row public."payments"%ROWTYPE;
    rent_row public."payments"%ROWTYPE;
BEGIN
    IF p_booking_id IS NULL OR p_tenant_id IS NULL OR p_monthly_rent IS NULL OR p_monthly_rent <= 0 THEN
        RETURN false;
    END IF;
    IF EXISTS (
        SELECT 1
          FROM public."stay_change_requests" AS request
         WHERE request."booking_id" = p_booking_id
           AND request."request_type" = 'Extension'
           AND request."status" = 'Pending'
    ) THEN
        RETURN false;
    END IF;

    SELECT payment.* INTO advance_row
      FROM public."payments" AS payment
     WHERE payment."booking_id" = p_booking_id
       AND payment."tenant_id" = p_tenant_id
       AND payment."payment_type" = 'Advance Rent'
       AND payment."status" IN ('Confirmed', 'Paid')
       AND payment."consumed_at" IS NULL
       AND round(payment."amount" - COALESCE((
           SELECT sum(refund."refund_amount")
             FROM public."refund_requests" AS refund
            WHERE refund."payment_id" = payment."payment_id"
              AND refund."status" = 'Approved'
       ), 0), 2) = round(p_monthly_rent, 2)
       AND NOT EXISTS (
           SELECT 1 FROM public."refund_requests" AS refund
            WHERE refund."payment_id" = payment."payment_id"
              AND refund."status" = 'Pending'
       )
     ORDER BY payment."due_date" NULLS FIRST, payment."payment_id"
     LIMIT 1
     FOR UPDATE OF payment;
    IF advance_row."payment_id" IS NULL THEN
        RETURN false;
    END IF;

    SELECT payment.* INTO rent_row
      FROM public."payments" AS payment
     WHERE payment."booking_id" = p_booking_id
       AND payment."tenant_id" = p_tenant_id
       AND payment."due_date" <= CURRENT_DATE
       AND COALESCE(payment."payment_type", '') NOT IN ('Security Deposit', 'Advance Rent', 'Advance Rent Applied')
       AND payment."status" IN ('Pending', 'Overdue')
       AND round(payment."amount", 2) = round(p_monthly_rent, 2)
       AND NOT EXISTS (
           SELECT 1
             FROM public."full_payment_request_items" AS item
             JOIN public."full_payment_requests" AS request USING ("request_id")
            WHERE item."payment_id" = payment."payment_id"
              AND request."status" IN ('Requested', 'Approved', 'Submitted')
       )
     ORDER BY payment."due_date", payment."payment_id"
     LIMIT 1
     FOR UPDATE OF payment;
    IF rent_row."payment_id" IS NULL THEN
        RETURN false;
    END IF;

    UPDATE public."payments"
       SET "status" = 'Cancelled',
           "description" = 'Monthly rent installment covered by booking advance',
           "payment_type" = 'Advance Rent Applied',
           "method" = 'Booking Advance',
           "gateway" = 'internal',
           "reference_number" = advance_row."reference_number",
           "confirmation_date" = CURRENT_TIMESTAMP,
           "paid_at" = CURRENT_TIMESTAMP
     WHERE "payment_id" = rent_row."payment_id";

    UPDATE public."payments"
       SET "consumed_at" = CURRENT_TIMESTAMP,
           "description" = 'One-month advance rent applied to rent due ' || rent_row."due_date"::text
     WHERE "payment_id" = advance_row."payment_id";

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_booking_advance_to_overdue_rent(integer, integer, numeric)
    FROM PUBLIC, anon, authenticated;

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
    period_end date;
    amount_value numeric(10,2);
    description_value text;
    plan_value text;
    booking_id_value integer;
    existing_payment_id integer;
    deposit_covers_first_month boolean;
    legacy_final_deposit boolean;
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
           AND b."status" IN ('Confirmed', 'Checked In', 'Active')
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
        legacy_final_deposit := booking_id_value IS NOT NULL AND EXISTS (
            SELECT 1
              FROM public."payments" AS deposit
             WHERE deposit."booking_id" = booking_id_value
               AND deposit."payment_type" = 'Security Deposit'
               AND deposit."description" = 'Security deposit applied to final rent'
        );
        deposit_covers_first_month := booking_id_value IS NOT NULL AND EXISTS (
            SELECT 1
              FROM public."payments" AS deposit
             WHERE deposit."booking_id" = booking_id_value
               AND deposit."payment_type" = 'Security Deposit'
               AND deposit."status" IN ('Confirmed', 'Paid')
               AND deposit."description" IN (
                   'One-month security deposit',
                   'One-month security deposit applied to first 30 days',
                   'One-month security deposit applied to first calendar month'
               )
               AND NOT EXISTS (
                   SELECT 1 FROM public."refund_requests" AS refund
                    WHERE refund."payment_id" = deposit."payment_id"
                      AND refund."status" = 'Pending'
               )
        );

        IF legacy_final_deposit THEN
            installment_total := CASE
                WHEN plan_value = 'Pay in Full' THEN 1
                ELSE greatest(1, month_total - 1)
            END;
        ELSE
            installment_total := month_total;
        END IF;

        IF deposit_covers_first_month
           AND CURRENT_DATE >= check_in THEN
            UPDATE public."payments" AS deposit
               SET "consumed_at" = COALESCE(deposit."consumed_at", CURRENT_TIMESTAMP),
                   "description" = 'One-month security deposit applied to first calendar month'
             WHERE deposit."booking_id" = booking_id_value
               AND deposit."payment_type" = 'Security Deposit'
               AND deposit."status" IN ('Confirmed', 'Paid')
               AND deposit."description" IN (
                   'One-month security deposit',
                   'One-month security deposit applied to first 30 days',
                   'One-month security deposit applied to first calendar month'
               )
               AND NOT EXISTS (
                   SELECT 1 FROM public."refund_requests" AS refund
                    WHERE refund."payment_id" = deposit."payment_id"
                      AND refund."status" = 'Pending'
               );
        END IF;

        FOR installment_index IN 0..(installment_total - 1) LOOP
            due_date_value := public.rent_add_months(check_in, installment_index);
            EXIT WHEN due_date_value >= check_out;

            IF installment_index = 0 AND deposit_covers_first_month THEN
                UPDATE public."payments" AS rent
                   SET "status" = 'Cancelled',
                       "description" = 'First calendar month covered by security deposit'
                 WHERE rent."booking_id" = booking_id_value
                   AND rent."due_date" = due_date_value
                   AND COALESCE(rent."payment_type", '') NOT IN ('Security Deposit', 'Advance Rent')
                   AND rent."status" IN ('Pending', 'Overdue')
                   AND rent."description" LIKE 'Monthly rent installment 1%'
                   AND NOT EXISTS (
                       SELECT 1
                         FROM public."full_payment_request_items" AS item
                         JOIN public."full_payment_requests" AS request USING ("request_id")
                        WHERE item."payment_id" = rent."payment_id"
                          AND request."status" IN ('Requested', 'Approved', 'Submitted')
                   );
                CONTINUE;
            END IF;

            existing_payment_id := NULL;
            IF booking_id_value IS NOT NULL THEN
                SELECT p."payment_id" INTO existing_payment_id
                  FROM public."payments" AS p
                 WHERE p."booking_id" = booking_id_value
                   AND p."due_date" = due_date_value
                   AND COALESCE(p."payment_type", '') NOT IN ('Security Deposit', 'Advance Rent')
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

            description_value := 'Monthly rent installment ' || (installment_index + 1)::text;
            IF existing_payment_id IS NOT NULL THEN
                UPDATE public."payments"
                   SET "tenant_id" = p_tenant_id,
                       "status" = CASE
                           WHEN "status" = 'Cancelled'
                            AND "description" = 'Final month covered by security deposit'
                            AND NOT legacy_final_deposit
                           THEN 'Pending'
                           ELSE "status"
                       END,
                       "amount" = CASE
                           WHEN "status" = 'Cancelled'
                            AND "description" = 'Final month covered by security deposit'
                            AND NOT legacy_final_deposit
                           THEN monthly_rent
                           ELSE "amount"
                       END,
                       "description" = CASE
                           WHEN "status" = 'Cancelled'
                            AND "description" = 'Final month covered by security deposit'
                            AND NOT legacy_final_deposit
                           THEN description_value
                           ELSE "description"
                       END,
                       "payment_type" = CASE
                           WHEN "status" = 'Cancelled'
                            AND "description" = 'Final month covered by security deposit'
                            AND NOT legacy_final_deposit
                           THEN plan_value
                           ELSE "payment_type"
                       END
                 WHERE "payment_id" = existing_payment_id;
                CONTINUE;
            END IF;

            period_end := public.rent_add_months(due_date_value, 1) - 1;
            SELECT p."payment_id" INTO existing_payment_id
              FROM public."payments" AS p
             WHERE p."tenant_id" = p_tenant_id
               AND p."booking_id" IS NULL
               AND p."due_date" BETWEEN due_date_value AND period_end
             ORDER BY p."payment_id"
             LIMIT 1;

            amount_value := CASE
                WHEN legacy_final_deposit AND plan_value = 'Pay in Full'
                THEN greatest(0, round(monthly_rent * month_total - monthly_rent, 2))
                ELSE monthly_rent
            END;
            description_value := CASE
                WHEN legacy_final_deposit AND plan_value = 'Pay in Full'
                THEN 'Full stay rent after security deposit credit'
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

        IF booking_id_value IS NOT NULL AND NOT legacy_final_deposit THEN
            IF public.apply_booking_advance_to_overdue_rent(
                booking_id_value,
                p_tenant_id,
                monthly_rent
            ) THEN
                payment_count := payment_count + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN payment_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_tenant_rent_schedule(integer) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_mark_deposit_consumed
    ON public."payments";

DO $migration$
DECLARE
    function_definition text;
    old_fragment text;
BEGIN
    SELECT pg_get_functiondef('public.manage_booking_refunds(text,jsonb)'::regprocedure)
      INTO function_definition;
    old_fragment := $old$
    IF actor_id IS NULL OR actor_role NOT IN ('Guest', 'Tenant') THEN
        RAISE EXCEPTION 'An active guest or tenant account is required.';
    END IF;
$old$;
    IF strpos(function_definition, old_fragment) = 0 THEN
        RAISE EXCEPTION 'Could not locate booking refund authorization to update.';
    END IF;
    function_definition := replace(
        function_definition,
        old_fragment,
        $new$
    IF actor_id IS NULL OR actor_role NOT IN ('Guest', 'Tenant') THEN
        RAISE EXCEPTION 'An active guest or tenant account is required.';
    END IF;

    IF actor_role = 'Tenant' THEN
        UPDATE public."payments" AS deposit
           SET "consumed_at" = COALESCE(deposit."consumed_at", CURRENT_TIMESTAMP),
               "description" = 'One-month security deposit applied to first calendar month'
          FROM public."tenants" AS tenant
         WHERE tenant."user_id" = actor_id
           AND tenant."is_active" = 1
           AND deposit."tenant_id" = tenant."tenant_id"
           AND deposit."payment_type" = 'Security Deposit'
           AND deposit."status" IN ('Confirmed', 'Paid')
           AND deposit."due_date" <= CURRENT_DATE
           AND deposit."consumed_at" IS NULL
           AND deposit."description" = 'One-month security deposit'
           AND NOT EXISTS (
               SELECT 1 FROM public."refund_requests" AS refund
                WHERE refund."payment_id" = deposit."payment_id"
                  AND refund."status" = 'Pending'
           );
    END IF;
$new$
    );
    EXECUTE function_definition;
END;
$migration$;

DO $migration$
DECLARE
    function_definition text;
    old_fragment text;
BEGIN
    SELECT pg_get_functiondef('public.manage_rent_ledger(text,jsonb)'::regprocedure)
      INTO function_definition;
    old_fragment := $old$
                         'description', p."description",
                         'reference_number', p."reference_number",
$old$;
    IF strpos(function_definition, old_fragment) = 0 THEN
        RAISE EXCEPTION 'Could not locate tenant rent-history fields to update.';
    END IF;
    function_definition := replace(
        function_definition,
        old_fragment,
        $new$
                         'description', p."description",
                         'payment_type', p."payment_type",
                         'booking_id', p."booking_id",
                         'reference_number', p."reference_number",
$new$
    );
    EXECUTE function_definition;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
