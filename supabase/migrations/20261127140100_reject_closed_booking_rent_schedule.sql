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

CREATE OR REPLACE FUNCTION public.prevent_payment_submission_for_closed_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW."status" = 'Submitted'
       AND NEW."booking_id" IS NOT NULL
       AND EXISTS (
           SELECT 1
             FROM public."bookings" AS booking
            WHERE booking."booking_id" = NEW."booking_id"
              AND booking."status" IN ('Rejected', 'Cancelled', 'Expired')
       ) THEN
        RAISE EXCEPTION 'Payment cannot be submitted for a rejected, cancelled, or expired booking.';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_payment_submission_for_closed_booking() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_reject_closed_booking_submission
    ON public."payments";
CREATE TRIGGER payments_reject_closed_booking_submission
    BEFORE INSERT OR UPDATE OF "status" ON public."payments"
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_payment_submission_for_closed_booking();

UPDATE public."payments" AS payment
   SET "tenant_id" = NULL,
       "status" = CASE WHEN payment."status" = 'Pending' THEN 'Cancelled' ELSE payment."status" END
  FROM public."bookings" AS booking
 WHERE booking."booking_id" = payment."booking_id"
   AND booking."status" IN ('Rejected', 'Cancelled', 'Expired')
   AND payment."status" IN ('Pending', 'Rejected', 'Cancelled')
   AND payment."tenant_id" IS NOT NULL;

NOTIFY pgrst, 'reload schema';
