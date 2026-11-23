UPDATE public."bookings" AS booking
   SET "payment_expires_at" = CASE
       WHEN booking."status" = 'Pending' THEN
           booking."created_at" AT TIME ZONE 'Asia/Manila' + interval '30 minutes'
       ELSE
           COALESCE(
               (
                   SELECT payment_request."submitted_at"
                     FROM public."booking_initial_payment_requests" AS payment_request
                    WHERE payment_request."booking_id" = booking."booking_id"
               ),
               booking."updated_at",
               booking."created_at"
           ) AT TIME ZONE 'Asia/Manila' + interval '24 hours'
   END
 WHERE booking."guest_user_id" IS NOT NULL
   AND booking."request_id" IS NOT NULL
   AND booking."status" IN ('Pending', 'Pending Verification');

UPDATE public."bookings" AS booking
   SET "status" = 'Expired',
       "updated_at" = CURRENT_TIMESTAMP
 WHERE booking."guest_user_id" IS NOT NULL
   AND booking."request_id" IS NOT NULL
   AND booking."status" IN ('Pending', 'Pending Verification')
   AND booking."payment_expires_at" <= CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION public.set_guest_booking_reservation_terms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."guest_user_id" IS NOT NULL
           AND NEW."request_id" IS NOT NULL
           AND NEW."status" = 'Pending' THEN
            NEW."reservation_type" := 'capacity_based';
            NEW."occupant_count" := 1;
            NEW."payment_expires_at" := CURRENT_TIMESTAMP + interval '30 minutes';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW."guest_user_id" IS NOT NULL
           AND NEW."request_id" IS NOT NULL
           AND OLD."status" = 'Pending'
           AND NEW."status" = 'Pending Verification' THEN
            NEW."payment_expires_at" := CURRENT_TIMESTAMP + interval '24 hours';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "bookings_set_guest_reservation_terms" ON public."bookings";
CREATE TRIGGER "bookings_set_guest_reservation_terms"
    BEFORE INSERT OR UPDATE OF "status" ON public."bookings"
    FOR EACH ROW
    EXECUTE FUNCTION public.set_guest_booking_reservation_terms();

ALTER TABLE public."bookings"
    DROP CONSTRAINT IF EXISTS "guest_active_booking_requires_reservation_deadline";
ALTER TABLE public."bookings"
    ADD CONSTRAINT "guest_active_booking_requires_reservation_deadline"
    CHECK (
        "guest_user_id" IS NULL
        OR "request_id" IS NULL
        OR "status" NOT IN ('Pending', 'Pending Verification')
        OR "payment_expires_at" IS NOT NULL
    );
