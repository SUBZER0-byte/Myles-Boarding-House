CREATE OR REPLACE FUNCTION public.enforce_guest_booking_deposit_plan_length()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW."guest_user_id" IS NOT NULL
       AND NEW."payment_plan" = 'Pay Monthly'
       AND NEW."length_of_stay_months" < 2 THEN
        RAISE EXCEPTION 'The one-month rent and deposit plan requires a stay of at least two months.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guest_booking_deposit_plan_minimum_stay_insert
    ON public."bookings";
CREATE TRIGGER trg_guest_booking_deposit_plan_minimum_stay_insert
    BEFORE INSERT ON public."bookings"
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_guest_booking_deposit_plan_length();

DROP TRIGGER IF EXISTS trg_guest_booking_deposit_plan_minimum_stay_update
    ON public."bookings";
CREATE TRIGGER trg_guest_booking_deposit_plan_minimum_stay_update
    BEFORE UPDATE OF "guest_user_id", "payment_plan", "length_of_stay_months"
    ON public."bookings"
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_guest_booking_deposit_plan_length();
