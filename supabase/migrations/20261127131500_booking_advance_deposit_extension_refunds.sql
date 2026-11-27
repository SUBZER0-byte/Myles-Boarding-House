ALTER TABLE public."payments"
    ADD COLUMN IF NOT EXISTS "consumed_at" timestamp without time zone,
    ADD COLUMN IF NOT EXISTS "consumed_by_stay_change_request_id" integer;

CREATE INDEX IF NOT EXISTS "payments_available_booking_advance"
    ON public."payments" ("booking_id", "payment_type", "status")
    WHERE "payment_type" = 'Advance Rent' AND "consumed_at" IS NULL;

CREATE OR REPLACE FUNCTION public.set_guest_booking_initial_charge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    guest_user_id integer;
    monthly_rent numeric(10,2);
BEGIN
    SELECT b."guest_user_id", r."monthly_rent"
      INTO guest_user_id, monthly_rent
      FROM public."bookings" AS b
      JOIN public."rooms" AS r ON r."room_id" = b."room_id"
     WHERE b."booking_id" = NEW."booking_id";

    IF guest_user_id IS NOT NULL THEN
        IF monthly_rent IS NULL OR monthly_rent <= 0 THEN
            RAISE EXCEPTION 'A valid room rate is required to calculate the booking deposit and advance.';
        END IF;
        NEW."amount" := round(monthly_rent * 2, 2);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_initial_payment_requires_deposit_and_advance
    ON public."booking_initial_payment_requests";
CREATE TRIGGER booking_initial_payment_requires_deposit_and_advance
    BEFORE INSERT ON public."booking_initial_payment_requests"
    FOR EACH ROW
    EXECUTE FUNCTION public.set_guest_booking_initial_charge();

UPDATE public."booking_initial_payment_requests" AS request
   SET "amount" = round(room."monthly_rent" * 2, 2)
  FROM public."bookings" AS booking
  JOIN public."rooms" AS room ON room."room_id" = booking."room_id"
 WHERE request."booking_id" = booking."booking_id"
   AND booking."guest_user_id" IS NOT NULL
   AND request."status" = 'Checkout'
   AND request."amount" IS DISTINCT FROM round(room."monthly_rent" * 2, 2);

DO $$
DECLARE
    initial_payment record;
    advance_payment_id integer;
BEGIN
    FOR initial_payment IN
        SELECT payment."payment_id", payment."booking_id", payment."tenant_id",
               payment."amount", payment."due_date", payment."status",
               payment."method", payment."gateway", payment."reference_number",
               payment."submitted_at", payment."confirmed_by",
               payment."confirmation_date", payment."paid_at", payment."created_at",
               payment."idempotency_key", booking."payment_plan",
               booking."move_in_date", room."monthly_rent"
          FROM public."payments" AS payment
          JOIN public."bookings" AS booking ON booking."booking_id" = payment."booking_id"
          JOIN public."rooms" AS room ON room."room_id" = booking."room_id"
         WHERE booking."guest_user_id" IS NOT NULL
           AND booking."payment_plan" IN ('Pay Monthly', 'Pay One Month Rent')
           AND payment."payment_type" = 'Initial Booking Payment'
           AND payment."status" IN ('Submitted', 'Confirmed', 'Paid')
         FOR UPDATE OF payment
    LOOP
        IF initial_payment."amount" = round(initial_payment."monthly_rent" * 2, 2) THEN
            UPDATE public."payments"
               SET "amount" = initial_payment."monthly_rent",
                   "due_date" = initial_payment."move_in_date",
                   "description" = 'One-month security deposit',
                   "payment_type" = 'Security Deposit'
             WHERE "payment_id" = initial_payment."payment_id";

            INSERT INTO public."payments" (
                "booking_id", "tenant_id", "amount", "due_date", "status",
                "description", "payment_type", "method", "gateway",
                "reference_number", "submitted_at", "confirmed_by",
                "confirmation_date", "paid_at", "created_at"
            ) VALUES (
                initial_payment."booking_id", initial_payment."tenant_id",
                initial_payment."monthly_rent", initial_payment."move_in_date",
                initial_payment."status", 'One-month advance rent', 'Advance Rent',
                initial_payment."method", initial_payment."gateway",
                initial_payment."reference_number", initial_payment."submitted_at",
                initial_payment."confirmed_by", initial_payment."confirmation_date",
                initial_payment."paid_at", initial_payment."created_at"
            )
            RETURNING "payment_id" INTO advance_payment_id;

            INSERT INTO public."payment_proofs" ("payment_id", "screenshot_path", "uploaded_at")
            SELECT advance_payment_id, proof."screenshot_path", proof."uploaded_at"
              FROM public."payment_proofs" AS proof
             WHERE proof."payment_id" = initial_payment."payment_id"
            ON CONFLICT ("payment_id") DO NOTHING;
        ELSIF initial_payment."amount" >= initial_payment."monthly_rent" THEN
            UPDATE public."payments"
               SET "due_date" = initial_payment."move_in_date",
                   "description" = 'One-month advance rent',
                   "payment_type" = 'Advance Rent'
             WHERE "payment_id" = initial_payment."payment_id";
        END IF;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.split_guest_booking_initial_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    guest_user_id integer;
    move_in_date date;
    monthly_rent numeric(10,2);
BEGIN
    IF NEW."payment_type" <> 'Initial Booking Payment'
       OR NEW."status" <> 'Submitted'
       OR NEW."booking_id" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT booking."guest_user_id", booking."move_in_date", room."monthly_rent"
      INTO guest_user_id, move_in_date, monthly_rent
      FROM public."bookings" AS booking
      JOIN public."rooms" AS room ON room."room_id" = booking."room_id"
     WHERE booking."booking_id" = NEW."booking_id";

    IF guest_user_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF monthly_rent IS NULL OR monthly_rent <= 0
       OR NEW."amount" IS DISTINCT FROM round(monthly_rent * 2, 2) THEN
        RAISE EXCEPTION 'The initial booking payment must include one month of deposit and one month of advance.';
    END IF;

    UPDATE public."payments"
       SET "amount" = monthly_rent,
           "due_date" = move_in_date,
           "description" = 'One-month security deposit',
           "payment_type" = 'Security Deposit'
     WHERE "payment_id" = NEW."payment_id";

    INSERT INTO public."payments" (
        "booking_id", "tenant_id", "amount", "due_date", "status",
        "description", "payment_type", "method", "gateway", "reference_number",
        "submitted_at", "created_at"
    ) VALUES (
        NEW."booking_id", NEW."tenant_id", monthly_rent, move_in_date,
        NEW."status", 'One-month advance rent', 'Advance Rent', NEW."method",
        NEW."gateway", NEW."reference_number", NEW."submitted_at", NEW."created_at"
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_split_guest_booking_initial_payment
    ON public."payments";
CREATE TRIGGER payments_split_guest_booking_initial_payment
    AFTER INSERT ON public."payments"
    FOR EACH ROW
    EXECUTE FUNCTION public.split_guest_booking_initial_payment();

CREATE OR REPLACE FUNCTION public.sync_guest_booking_component_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF OLD."payment_type" = 'Security Deposit'
       AND NEW."payment_type" = 'Security Deposit'
       AND OLD."status" = 'Submitted'
       AND NEW."status" IN ('Confirmed', 'Rejected') THEN
        UPDATE public."payments"
           SET "status" = NEW."status",
               "confirmed_by" = NEW."confirmed_by",
               "confirmation_date" = NEW."confirmation_date"
         WHERE "booking_id" = NEW."booking_id"
           AND "payment_type" = 'Advance Rent'
           AND "status" = 'Submitted'
           AND "created_at" = NEW."created_at";
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_sync_guest_booking_component_status
    ON public."payments";
CREATE TRIGGER payments_sync_guest_booking_component_status
    AFTER UPDATE OF "status" ON public."payments"
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_guest_booking_component_payment_status();

CREATE OR REPLACE FUNCTION public.copy_guest_booking_component_payment_proof()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    deposit_payment record;
BEGIN
    SELECT payment."booking_id", payment."created_at"
      INTO deposit_payment
      FROM public."payments" AS payment
     WHERE payment."payment_id" = NEW."payment_id"
       AND payment."payment_type" = 'Security Deposit'
       AND payment."idempotency_key" IS NOT NULL;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    INSERT INTO public."payment_proofs" ("payment_id", "screenshot_path", "uploaded_at")
    SELECT advance."payment_id", NEW."screenshot_path", NEW."uploaded_at"
      FROM public."payments" AS advance
     WHERE advance."booking_id" = deposit_payment."booking_id"
       AND advance."payment_type" = 'Advance Rent'
       AND advance."idempotency_key" IS NULL
       AND advance."created_at" = deposit_payment."created_at"
    ON CONFLICT ("payment_id") DO UPDATE
        SET "screenshot_path" = EXCLUDED."screenshot_path",
            "uploaded_at" = EXCLUDED."uploaded_at";
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_proofs_copy_guest_booking_component
    ON public."payment_proofs";
CREATE TRIGGER payment_proofs_copy_guest_booking_component
    AFTER INSERT OR UPDATE OF "screenshot_path" ON public."payment_proofs"
    FOR EACH ROW
    EXECUTE FUNCTION public.copy_guest_booking_component_payment_proof();

CREATE OR REPLACE FUNCTION public.check_booking_component_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    payment_row public."payments"%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND NOT (OLD."status" = 'Pending' AND NEW."status" = 'Approved') THEN
        RETURN NEW;
    END IF;

    SELECT payment.* INTO payment_row
      FROM public."payments" AS payment
     WHERE payment."payment_id" = NEW."payment_id"
     FOR UPDATE;

    IF payment_row."payment_type" NOT IN ('Security Deposit', 'Advance Rent') THEN
        RETURN NEW;
    END IF;
    IF payment_row."status" NOT IN ('Confirmed', 'Paid')
       OR payment_row."consumed_at" IS NOT NULL THEN
        RAISE EXCEPTION 'A consumed or unpaid deposit/advance cannot be refunded.';
    END IF;
    IF payment_row."payment_type" = 'Security Deposit'
       AND (
           payment_row."due_date" IS NULL
           OR CURRENT_DATE <= payment_row."due_date"
           OR CURRENT_DATE >= (payment_row."due_date" + interval '1 month')::date
       ) THEN
        RAISE EXCEPTION 'The deposit can only be refunded after one full day and within one month of move-in.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refund_requests_validate_booking_components
    ON public."refund_requests";
CREATE TRIGGER refund_requests_validate_booking_components
    BEFORE INSERT OR UPDATE OF "status" ON public."refund_requests"
    FOR EACH ROW
    EXECUTE FUNCTION public.check_booking_component_refund();

CREATE OR REPLACE FUNCTION public.manage_booking_refunds(
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
    booking_id_value integer;
    payment_id_value integer;
    result jsonb;
BEGIN
    actor_id := public.current_app_user_id();
    actor_role := public.current_app_user_role();
    IF actor_id IS NULL OR actor_role NOT IN ('Guest', 'Tenant') THEN
        RAISE EXCEPTION 'An active guest or tenant account is required.';
    END IF;

    IF p_action = 'tenant_components' THEN
        IF actor_role <> 'Tenant' THEN
            RAISE EXCEPTION 'Tenant access is required.';
        END IF;
        SELECT COALESCE(jsonb_agg(row_data ORDER BY payment_id), '[]'::jsonb)
          INTO result
          FROM (
              SELECT payment."payment_id",
                     jsonb_build_object(
                         'payment_id', payment."payment_id",
                         'booking_id', payment."booking_id",
                         'payment_type', payment."payment_type",
                         'refund_available',
                             payment."status" IN ('Confirmed', 'Paid')
                             AND payment."consumed_at" IS NULL
                             AND payment."amount" > COALESCE((
                                 SELECT sum(refund."refund_amount")
                                   FROM public."refund_requests" AS refund
                                  WHERE refund."payment_id" = payment."payment_id"
                                    AND refund."status" = 'Approved'
                             ), 0)
                             AND NOT EXISTS (
                                 SELECT 1 FROM public."refund_requests" AS refund
                                  WHERE refund."payment_id" = payment."payment_id"
                                    AND refund."status" = 'Pending'
                             )
                             AND (
                                 payment."payment_type" = 'Advance Rent'
                                 OR (
                                     payment."payment_type" = 'Security Deposit'
                                     AND payment."due_date" IS NOT NULL
                                     AND CURRENT_DATE > payment."due_date"
                                     AND CURRENT_DATE < (payment."due_date" + interval '1 month')::date
                                 )
                             )
                     ) AS row_data
                FROM public."payments" AS payment
                JOIN public."bookings" AS booking ON booking."booking_id" = payment."booking_id"
                JOIN public."tenants" AS tenant ON tenant."tenant_id" = payment."tenant_id"
               WHERE tenant."user_id" = actor_id
                 AND tenant."is_active" = 1
                 AND payment."payment_type" IN ('Security Deposit', 'Advance Rent')
          ) AS component_payments;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF p_action NOT IN ('eligible', 'submit') THEN
        RAISE EXCEPTION 'Invalid booking refund action.';
    END IF;
    IF COALESCE(p_data->>'booking_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
        RAISE EXCEPTION 'A valid booking ID is required.';
    END IF;
    booking_id_value := (p_data->>'booking_id')::integer;
    IF p_data ? 'payment_id' AND COALESCE(p_data->>'payment_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
        RAISE EXCEPTION 'A valid payment ID is required.';
    END IF;
    payment_id_value := NULLIF(p_data->>'payment_id', '')::integer;

    IF p_action = 'eligible' THEN
        SELECT COALESCE(jsonb_agg(row_data ORDER BY payment_id), '[]'::jsonb)
          INTO result
          FROM (
              SELECT payment."payment_id",
                     jsonb_build_object(
                         'payment_id', payment."payment_id",
                         'booking_id', payment."booking_id",
                         'amount', payment."amount",
                         'remaining_amount', payment."amount" - COALESCE((
                             SELECT sum(refund."refund_amount")
                               FROM public."refund_requests" AS refund
                              WHERE refund."payment_id" = payment."payment_id"
                                AND refund."status" = 'Approved'
                         ), 0),
                         'payment_type', payment."payment_type",
                         'method', payment."method",
                         'reference_number', payment."reference_number",
                         'description', payment."description",
                         'due_date', payment."due_date",
                         'has_pending_request', EXISTS (
                             SELECT 1 FROM public."refund_requests" AS refund
                              WHERE refund."payment_id" = payment."payment_id"
                                AND refund."status" = 'Pending'
                         )
                     ) AS row_data
                FROM public."payments" AS payment
                JOIN public."bookings" AS booking ON booking."booking_id" = payment."booking_id"
                LEFT JOIN public."tenants" AS tenant ON tenant."tenant_id" = payment."tenant_id"
               WHERE booking."booking_id" = booking_id_value
                 AND payment."payment_type" IN ('Security Deposit', 'Advance Rent')
                 AND payment."status" IN ('Confirmed', 'Paid')
                 AND payment."consumed_at" IS NULL
                 AND (
                     (actor_role = 'Guest' AND booking."guest_user_id" = actor_id)
                     OR (actor_role = 'Tenant' AND tenant."user_id" = actor_id AND tenant."is_active" = 1)
                 )
                 AND (
                     payment."payment_type" = 'Advance Rent'
                     OR (
                         payment."due_date" IS NOT NULL
                         AND CURRENT_DATE > payment."due_date"
                         AND CURRENT_DATE < (payment."due_date" + interval '1 month')::date
                     )
                 )
                 AND (payment_id_value IS NULL OR payment."payment_id" = payment_id_value)
                 AND payment."amount" > COALESCE((
                     SELECT sum(refund."refund_amount")
                       FROM public."refund_requests" AS refund
                      WHERE refund."payment_id" = payment."payment_id"
                        AND refund."status" = 'Approved'
                 ), 0)
          ) AS eligible_components;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF payment_id_value IS NULL
       OR COALESCE(p_data->>'idempotency_key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'A valid payment and request identifier are required.';
    END IF;
    RETURN public.submit_booking_component_refund(
        p_data, actor_id, actor_role, booking_id_value, payment_id_value
    );
END;
$$;

REVOKE ALL ON FUNCTION public.manage_booking_refunds(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_booking_refunds(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_booking_component_refund(
    p_data jsonb,
    p_actor_id integer,
    p_actor_role text,
    p_booking_id integer,
    p_payment_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    payment_row public."payments"%ROWTYPE;
    existing_refund public."refund_requests"%ROWTYPE;
    idempotency_key_value uuid := (p_data->>'idempotency_key')::uuid;
    reference_value text := NULLIF(btrim(p_data->>'transaction_reference'), '');
    proof_path text := NULLIF(p_data->>'screenshot_path', '');
    refund_total numeric(10,2);
    remaining_amount numeric(10,2);
    refund_id_value integer;
BEGIN
    SELECT refund.* INTO existing_refund
      FROM public."refund_requests" AS refund
     WHERE refund."user_id" = p_actor_id
       AND refund."idempotency_key" = idempotency_key_value;
    IF existing_refund."refund_id" IS NOT NULL THEN
        IF existing_refund."payment_id" = p_payment_id THEN
            RETURN jsonb_build_object(
                'type', 'success',
                'message', 'Refund request already submitted',
                'data', jsonb_build_object(
                    'refund_id', existing_refund."refund_id",
                    'refund_amount', existing_refund."refund_amount"
                )
            );
        END IF;
        RAISE EXCEPTION 'Refund request identifier was already used.';
    END IF;

    IF length(COALESCE(p_data->>'gcash_account_name', '')) > 120
       OR btrim(COALESCE(p_data->>'gcash_account_name', '')) = ''
       OR length(COALESCE(p_data->>'gcash_number', '')) > 30
       OR btrim(COALESCE(p_data->>'gcash_number', '')) = ''
       OR length(COALESCE(reference_value, '')) > 120
       OR length(COALESCE(p_data->>'reason', '')) > 2000 THEN
        RAISE EXCEPTION 'Enter a valid GCash account name and number.';
    END IF;
    IF proof_path IS NOT NULL
       AND proof_path !~ ('^' || auth.uid()::text || '/refund/' || p_payment_id::text || '/' || idempotency_key_value::text || '\.(jpg|png|webp)$') THEN
        RAISE EXCEPTION 'Invalid refund screenshot path.';
    END IF;

    SELECT payment.* INTO payment_row
      FROM public."payments" AS payment
      JOIN public."bookings" AS booking ON booking."booking_id" = payment."booking_id"
      LEFT JOIN public."tenants" AS tenant ON tenant."tenant_id" = payment."tenant_id"
     WHERE payment."payment_id" = p_payment_id
       AND payment."booking_id" = p_booking_id
       AND payment."payment_type" IN ('Security Deposit', 'Advance Rent')
       AND (
           (p_actor_role = 'Guest' AND booking."guest_user_id" = p_actor_id)
           OR (p_actor_role = 'Tenant' AND tenant."user_id" = p_actor_id AND tenant."is_active" = 1)
       )
     FOR UPDATE OF payment;
    IF payment_row."payment_id" IS NULL
       OR payment_row."status" NOT IN ('Confirmed', 'Paid')
       OR payment_row."consumed_at" IS NOT NULL THEN
        RAISE EXCEPTION 'This deposit or advance is not refundable.';
    END IF;
    IF payment_row."payment_type" = 'Security Deposit'
       AND (
           payment_row."due_date" IS NULL
           OR CURRENT_DATE <= payment_row."due_date"
           OR CURRENT_DATE >= (payment_row."due_date" + interval '1 month')::date
       ) THEN
        RAISE EXCEPTION 'The deposit can only be refunded after one full day and within one month of move-in.';
    END IF;
    IF reference_value IS NULL AND NULLIF(btrim(payment_row."reference_number"), '') IS NULL AND proof_path IS NULL THEN
        RAISE EXCEPTION 'Provide a transaction number or GCash payment screenshot.';
    END IF;
    IF proof_path IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM storage.objects
         WHERE bucket_id = 'mbh-financial-evidence' AND name = proof_path
    ) THEN
        RAISE EXCEPTION 'Refund screenshot upload was not found.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public."refund_requests"
         WHERE "payment_id" = p_payment_id AND "status" = 'Pending'
    ) THEN
        RAISE EXCEPTION 'A refund request for this payment is already pending.';
    END IF;
    SELECT COALESCE(sum("refund_amount"), 0)::numeric(10,2)
      INTO refund_total
      FROM public."refund_requests"
     WHERE "payment_id" = p_payment_id AND "status" = 'Approved';
    remaining_amount := round(payment_row."amount" - refund_total, 2);
    IF remaining_amount <= 0 THEN
        RAISE EXCEPTION 'This payment has no remaining refundable amount.';
    END IF;
    INSERT INTO public."refund_requests" (
        "payment_id", "user_id", "refund_amount", "gcash_account_name",
        "gcash_number", "transaction_reference", "screenshot_path", "reason",
        "idempotency_key"
    ) VALUES (
        p_payment_id, p_actor_id, remaining_amount,
        btrim(p_data->>'gcash_account_name'), btrim(p_data->>'gcash_number'),
        reference_value, proof_path, NULLIF(btrim(p_data->>'reason'), ''),
        idempotency_key_value
    )
    RETURNING "refund_id" INTO refund_id_value;

    INSERT INTO public."notifications" ("user_id", "title", "message", "type")
    SELECT u."user_id", 'Refund Request',
           'A refund request for payment #' || p_payment_id || ' is awaiting review.',
           'refund'
      FROM public."users" AS u
     WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
    INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
    VALUES (p_actor_id, 'payment', 'refund_requested',
            'User #' || p_actor_id || ' requested a booking component refund for payment #' || p_payment_id);

    RETURN jsonb_build_object(
        'type', 'success',
        'message', 'Refund request submitted for admin review',
        'data', jsonb_build_object('refund_id', refund_id_value, 'refund_amount', remaining_amount)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_booking_component_refund(jsonb, integer, text, integer, integer)
    FROM PUBLIC, anon, authenticated;

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
       AND tenant."is_active" = 1
       AND payment."amount" - COALESCE((
           SELECT sum(refund."refund_amount")
             FROM public."refund_requests" AS refund
            WHERE refund."payment_id" = payment."payment_id"
              AND refund."status" = 'Approved'
       ), 0) >= monthly_rent
       AND NOT EXISTS (
           SELECT 1 FROM public."refund_requests" AS refund
            WHERE refund."payment_id" = payment."payment_id"
              AND refund."status" = 'Pending'
       )
     ORDER BY payment."due_date" NULLS FIRST, payment."payment_id"
     LIMIT 1
     FOR UPDATE OF payment;

    IF advance_payment_id IS NULL THEN
        RAISE EXCEPTION 'A confirmed, unused one-month advance with no pending refund is required to request an extension.';
    END IF;
    RETURN NEW;
END;
$$;

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
    credit_amount numeric(10,2);
    remaining_advance numeric(10,2);
    remaining_rent_payment numeric(10,2);
    approved_refunds numeric(10,2);
BEGIN
    IF OLD."status" <> 'Pending'
       OR NEW."status" <> 'Approved'
       OR NEW."request_type" <> 'Extension' THEN
        RETURN NEW;
    END IF;

    SELECT booking."booking_id", booking."room_id", booking."move_in_date",
           booking."check_out_date", booking."payment_plan", booking."total_rent",
           booking."length_of_stay_months",
           COALESCE(
               NULLIF(booking."total_rent" / NULLIF(booking."length_of_stay_months", 0), 0),
               room."monthly_rent"
           ) AS monthly_rent,
           tenant."tenant_id"
      INTO booking_row
      FROM public."bookings" AS booking
      JOIN public."rooms" AS room ON room."room_id" = booking."room_id"
      JOIN public."tenants" AS tenant ON tenant."room_id" = booking."room_id"
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
       AND payment."amount" - COALESCE((
           SELECT sum(refund."refund_amount")
             FROM public."refund_requests" AS refund
            WHERE refund."payment_id" = payment."payment_id"
              AND refund."status" = 'Approved'
       ), 0) >= booking_row."monthly_rent"
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
    IF advance_row."amount" - approved_refunds < booking_row."monthly_rent" THEN
        RAISE EXCEPTION 'The available booking advance is not enough to cover one full month of rent.';
    END IF;
    credit_amount := booking_row."monthly_rent";

    SELECT payment."payment_id", payment."amount"
      INTO rent_payment_id, rent_payment_amount
      FROM public."payments" AS payment
     WHERE payment."booking_id" = NEW."booking_id"
       AND payment."due_date" = NEW."original_check_out_date"
       AND payment."payment_type" NOT IN ('Security Deposit', 'Advance Rent')
       AND payment."status" IN ('Pending', 'Overdue')
     ORDER BY payment."payment_id"
     LIMIT 1
     FOR UPDATE;

    IF rent_payment_id IS NULL OR rent_payment_amount < credit_amount THEN
        RAISE EXCEPTION 'The first extension rent installment could not be credited with the booking advance.';
    END IF;

    remaining_rent_payment := round(rent_payment_amount - credit_amount, 2);
    IF remaining_rent_payment = 0 THEN
        DELETE FROM public."payments" WHERE "payment_id" = rent_payment_id;
    ELSE
        UPDATE public."payments"
           SET "amount" = remaining_rent_payment
         WHERE "payment_id" = rent_payment_id;
    END IF;

    INSERT INTO public."payments" (
        "booking_id", "tenant_id", "amount", "due_date", "status",
        "description", "payment_type", "method", "gateway", "reference_number",
        "confirmation_date", "paid_at", "created_at"
    ) VALUES (
        NEW."booking_id", booking_row."tenant_id", credit_amount,
        NEW."original_check_out_date", 'Confirmed',
        'Extension rent paid using booking advance', 'Extension',
        'Booking Advance', 'internal', advance_row."reference_number",
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    remaining_advance := round(advance_row."amount" - credit_amount, 2);
    IF remaining_advance > approved_refunds THEN
        UPDATE public."payments"
           SET "amount" = remaining_advance,
               "description" = 'Remaining booking advance'
         WHERE "payment_id" = advance_row."payment_id";
    ELSE
        UPDATE public."payments"
           SET "status" = 'Cancelled',
               "consumed_at" = CURRENT_TIMESTAMP,
               "consumed_by_stay_change_request_id" = NEW."request_id",
               "description" = 'Booking advance consumed by extension #' || NEW."request_id"
         WHERE "payment_id" = advance_row."payment_id";
    END IF;

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

DROP TRIGGER IF EXISTS stay_extension_apply_booking_advance
    ON public."stay_change_requests";
CREATE TRIGGER stay_extension_apply_booking_advance
    AFTER UPDATE OF "status" ON public."stay_change_requests"
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_booking_advance_to_extension();

CREATE OR REPLACE FUNCTION public.mark_deposit_consumed_by_final_rent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW."status" = 'Cancelled'
       AND NEW."description" = 'Final month covered by security deposit'
       AND OLD."status" IS DISTINCT FROM NEW."status" THEN
        UPDATE public."payments"
           SET "status" = 'Cancelled',
               "consumed_at" = CURRENT_TIMESTAMP,
               "description" = 'Security deposit applied to final rent'
         WHERE "booking_id" = NEW."booking_id"
           AND "payment_type" = 'Security Deposit'
           AND "status" IN ('Confirmed', 'Paid')
           AND "consumed_at" IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_mark_deposit_consumed
    ON public."payments";
CREATE TRIGGER payments_mark_deposit_consumed
    AFTER UPDATE OF "status", "description" ON public."payments"
    FOR EACH ROW
    EXECUTE FUNCTION public.mark_deposit_consumed_by_final_rent();

CREATE OR REPLACE FUNCTION public.get_my_tenant_room()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH current_tenant AS (
        SELECT t."tenant_id", t."user_id", t."room_id", t."full_name" AS "tenant_name",
               t."email" AS "tenant_email", t."move_in_date", t."move_out_date",
               u."email" AS "user_email"
        FROM public."tenants" AS t
        INNER JOIN public."users" AS u ON u."user_id" = t."user_id"
        WHERE u."auth_user_id" = auth.uid()
          AND u."user_type" = 'Tenant'
          AND u."is_active" = 1
          AND t."is_active" = 1
          AND t."deleted_at" IS NULL
        ORDER BY t."tenant_id" DESC
        LIMIT 1
    ),
    roommates AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'tenant_id', roommate."tenant_id",
                    'full_name', roommate."full_name",
                    'gender', COALESCE(roommate_user."gender", 'Not provided'),
                    'move_in_date', roommate."move_in_date",
                    'move_out_date', roommate."move_out_date"
                )
                ORDER BY roommate."full_name"
            ),
            '[]'::jsonb
        ) AS data
        FROM current_tenant AS current_row
        JOIN public."tenants" AS roommate
          ON roommate."room_id" = current_row."room_id"
         AND roommate."tenant_id" <> current_row."tenant_id"
         AND roommate."is_active" = 1
         AND roommate."deleted_at" IS NULL
         AND COALESCE(roommate."move_out_date", '9999-12-31'::date) > CURRENT_DATE
        LEFT JOIN public."users" AS roommate_user
          ON roommate_user."user_id" = roommate."user_id"
    )
    SELECT jsonb_build_object(
        'room_id', r."room_id",
        'room_number', r."room_number",
        'floor_number', r."floor_number",
        'room_type', r."room_type",
        'capacity', r."capacity",
        'monthly_rent', COALESCE(booking."monthly_rent", r."monthly_rent"),
        'status', r."status",
        'description', r."description",
        'tenant_id', t."tenant_id",
        'tenant_name', t."tenant_name",
        'move_in_date', t."move_in_date",
        'move_out_date', t."move_out_date",
        'booking_id', booking."booking_id",
        'check_out_date', booking."check_out_date",
        'roommates', COALESCE(roommates.data, '[]'::jsonb),
        'available_advance_amount', COALESCE((
            SELECT sum(payment."amount" - COALESCE((
                SELECT sum(refund."refund_amount")
                  FROM public."refund_requests" AS refund
                 WHERE refund."payment_id" = payment."payment_id"
                   AND refund."status" = 'Approved'
            ), 0))
              FROM public."payments" AS payment
             WHERE payment."booking_id" = booking."booking_id"
               AND payment."tenant_id" = t."tenant_id"
               AND payment."payment_type" = 'Advance Rent'
               AND payment."status" IN ('Confirmed', 'Paid')
               AND payment."consumed_at" IS NULL
               AND NOT EXISTS (
                   SELECT 1 FROM public."refund_requests" AS refund
                    WHERE refund."payment_id" = payment."payment_id"
                      AND refund."status" = 'Pending'
               )
        ), 0),
        'requested_move_out_date', (
            SELECT stay_change."requested_check_out_date"
            FROM public."stay_change_requests" AS stay_change
            WHERE stay_change."booking_id" = booking."booking_id"
              AND stay_change."request_type" = 'Extension'
              AND stay_change."status" = 'Pending'
            ORDER BY stay_change."created_at" DESC, stay_change."request_id" DESC
            LIMIT 1
        ),
        'extension_request_status', (
            SELECT stay_change."status"
            FROM public."stay_change_requests" AS stay_change
            WHERE stay_change."booking_id" = booking."booking_id"
              AND stay_change."request_type" = 'Extension'
            ORDER BY stay_change."created_at" DESC, stay_change."request_id" DESC
            LIMIT 1
        )
    )
    FROM current_tenant AS t
    INNER JOIN public."rooms" AS r ON r."room_id" = t."room_id"
    LEFT JOIN LATERAL (
        SELECT b."booking_id", b."check_out_date",
               COALESCE(
                   NULLIF(b."total_rent" / NULLIF(b."length_of_stay_months", 0), 0),
                   r."monthly_rent"
               ) AS "monthly_rent"
        FROM public."bookings" AS b
        WHERE b."room_id" = t."room_id"
          AND b."status" IN ('Confirmed', 'Checked In', 'Active')
          AND (
              (NULLIF(btrim(t."user_email"), '') IS NOT NULL
               AND lower(btrim(b."email")) = lower(btrim(t."user_email")))
              OR (NULLIF(btrim(t."tenant_email"), '') IS NOT NULL
                  AND lower(btrim(b."email")) = lower(btrim(t."tenant_email")))
          )
        ORDER BY b."created_at" DESC, b."booking_id" DESC
        LIMIT 1
    ) AS booking ON true
    LEFT JOIN roommates ON true;
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant_room() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_room() TO authenticated;

NOTIFY pgrst, 'reload schema';

