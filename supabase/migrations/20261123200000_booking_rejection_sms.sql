ALTER TABLE public."booking_initial_payment_requests"
    ADD COLUMN IF NOT EXISTS "rejection_reason" text;

ALTER TABLE public."booking_initial_payment_requests"
    ADD COLUMN IF NOT EXISTS "rejected_by" integer
        REFERENCES public."users" ("user_id") ON DELETE SET NULL;

ALTER TABLE public.booking_sms_notification_events
    DROP CONSTRAINT IF EXISTS booking_sms_notification_events_event_type_check;
ALTER TABLE public.booking_sms_notification_events
    ADD CONSTRAINT booking_sms_notification_events_event_type_check
    CHECK (event_type IN ('payment_submitted', 'booking_confirmed', 'booking_rejected'));

CREATE OR REPLACE FUNCTION public.claim_booking_sms_notification(
    p_booking_id integer,
    p_event_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    claimed boolean;
BEGIN
    IF p_booking_id IS NULL
       OR p_booking_id <= 0
       OR p_event_type IS NULL
       OR p_event_type NOT IN ('payment_submitted', 'booking_confirmed', 'booking_rejected') THEN
        RAISE EXCEPTION 'Invalid booking SMS notification request';
    END IF;

    WITH claim AS (
        INSERT INTO public.booking_sms_notification_events (
            booking_id, event_type, status, attempt_count, updated_at
        ) VALUES (
            p_booking_id, p_event_type, 'sending', 1, CURRENT_TIMESTAMP
        )
        ON CONFLICT (booking_id, event_type) DO UPDATE
           SET status = 'sending',
               attempt_count = public.booking_sms_notification_events.attempt_count + 1,
               sent_count = 0,
               failed_count = 0,
               last_error = NULL,
               sent_at = NULL,
               updated_at = CURRENT_TIMESTAMP
         WHERE (
                public.booking_sms_notification_events.status = 'failed'
                AND public.booking_sms_notification_events.attempt_count < 3
                AND public.booking_sms_notification_events.updated_at
                    < CURRENT_TIMESTAMP - interval '1 minute'
            )
            OR (
                public.booking_sms_notification_events.status = 'sending'
                AND public.booking_sms_notification_events.attempt_count < 3
                AND public.booking_sms_notification_events.updated_at
                    < CURRENT_TIMESTAMP - interval '10 minutes'
            )
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM claim) INTO claimed;

    RETURN claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_booking_sms_notification(
    p_booking_id integer,
    p_event_type text,
    p_status text,
    p_sent_count integer,
    p_failed_count integer,
    p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_booking_id IS NULL
       OR p_booking_id <= 0
       OR p_event_type IS NULL
       OR p_event_type NOT IN ('payment_submitted', 'booking_confirmed', 'booking_rejected')
       OR p_status IS NULL
       OR p_status NOT IN ('sent', 'partial', 'failed')
       OR p_sent_count IS NULL
       OR p_sent_count < 0
       OR p_failed_count IS NULL
       OR p_failed_count < 0 THEN
        RAISE EXCEPTION 'Invalid booking SMS notification result';
    END IF;

    UPDATE public.booking_sms_notification_events
       SET status = p_status,
           sent_count = p_sent_count,
           failed_count = p_failed_count,
           last_error = CASE WHEN p_status = 'sent' THEN NULL ELSE left(p_error, 500) END,
           sent_at = CASE WHEN p_sent_count > 0 THEN CURRENT_TIMESTAMP ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
     WHERE booking_id = p_booking_id
       AND event_type = p_event_type
       AND status = 'sending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking SMS notification claim was not found';
    END IF;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_booking_payment_rejection_details()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW."status" = 'Rejected'
       AND OLD."status" IS DISTINCT FROM 'Rejected'
       AND (
           NULLIF(btrim(NEW."rejection_reason"), '') IS NULL
           OR length(NEW."rejection_reason") > 300
           OR NEW."rejected_by" IS NULL
       ) THEN
        RAISE EXCEPTION 'A rejection reason is required before rejecting a booking payment';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "booking_initial_payment_rejection_details_required"
    ON public."booking_initial_payment_requests";
CREATE TRIGGER "booking_initial_payment_rejection_details_required"
    BEFORE UPDATE OF "status" ON public."booking_initial_payment_requests"
    FOR EACH ROW
    EXECUTE FUNCTION public.require_booking_payment_rejection_details();

CREATE OR REPLACE FUNCTION public.reject_guest_booking_payment_with_reason(
    p_booking_id integer,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    actor_id integer;
    reason_value text;
    booking_lock_id integer;
    payment_request public."booking_initial_payment_requests"%ROWTYPE;
    decision_result jsonb;
BEGIN
    IF p_booking_id IS NULL OR p_booking_id <= 0 THEN
        RAISE EXCEPTION 'A valid booking ID is required';
    END IF;

    reason_value := regexp_replace(btrim(COALESCE(p_reason, '')), '[[:space:]]+', ' ', 'g');
    IF reason_value = '' OR length(reason_value) > 300 THEN
        RAISE EXCEPTION 'Enter a rejection reason of no more than 300 characters';
    END IF;

    SELECT app_user."user_id"
      INTO actor_id
      FROM public."users" AS app_user
     WHERE app_user."auth_user_id" = auth.uid()
       AND app_user."user_type" = 'Admin'
       AND app_user."is_active" = 1
     LIMIT 1;
    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    SELECT booking."booking_id"
      INTO booking_lock_id
      FROM public."bookings" AS booking
     WHERE booking."booking_id" = p_booking_id
     FOR UPDATE;
    IF booking_lock_id IS NULL THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    SELECT request.*
      INTO payment_request
      FROM public."booking_initial_payment_requests" AS request
     WHERE request."booking_id" = p_booking_id
     FOR UPDATE;
    IF payment_request."booking_id" IS NULL THEN
        RAISE EXCEPTION 'Booking payment not found';
    END IF;

    IF payment_request."status" = 'Rejected' THEN
        IF NULLIF(btrim(payment_request."rejection_reason"), '') IS NULL THEN
            UPDATE public."booking_initial_payment_requests"
               SET "rejection_reason" = reason_value,
                   "rejected_by" = actor_id
             WHERE "booking_id" = p_booking_id;
        ELSIF payment_request."rejection_reason" IS DISTINCT FROM reason_value THEN
            RAISE EXCEPTION 'A different rejection reason is already recorded';
        ELSIF payment_request."rejected_by" IS NOT NULL
              AND payment_request."rejected_by" <> actor_id THEN
            RAISE EXCEPTION 'Only the administrator who rejected the payment can retry its notification';
        ELSE
            UPDATE public."booking_initial_payment_requests"
               SET "rejected_by" = actor_id
             WHERE "booking_id" = p_booking_id
               AND "rejected_by" IS NULL;
        END IF;
    ELSE
        IF payment_request."status" <> 'Submitted' THEN
            RAISE EXCEPTION 'This initial payment is not awaiting review';
        END IF;
        UPDATE public."booking_initial_payment_requests"
           SET "rejection_reason" = reason_value,
               "rejected_by" = actor_id
         WHERE "booking_id" = p_booking_id;

        decision_result := public.manage_guest_booking(
            'admin_reject_initial_payment',
            jsonb_build_object('booking_id', p_booking_id)
        );
        IF decision_result->>'type' IS DISTINCT FROM 'success' THEN
            RAISE EXCEPTION '%', COALESCE(
                decision_result->>'message',
                'Could not reject the booking payment'
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'type', 'success',
        'message', 'Initial payment rejected',
        'data', jsonb_build_object('rejection_reason', reason_value)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.require_booking_payment_rejection_details()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_guest_booking_payment_with_reason(integer, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_guest_booking_payment_with_reason(integer, text)
    TO authenticated;

REVOKE ALL ON FUNCTION public.claim_booking_sms_notification(integer, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_booking_sms_notification(integer, text)
    TO service_role;
REVOKE ALL ON FUNCTION public.finish_booking_sms_notification(integer, text, text, integer, integer, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_booking_sms_notification(integer, text, text, integer, integer, text)
    TO service_role;
