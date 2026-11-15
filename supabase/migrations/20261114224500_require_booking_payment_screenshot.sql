CREATE OR REPLACE FUNCTION public.require_booking_payment_screenshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW."status" = 'Submitted'
       AND NEW."method" = 'GCash'
       AND NULLIF(btrim(NEW."screenshot_path"), '') IS NULL THEN
        RAISE EXCEPTION 'A GCash payment screenshot is required';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_booking_payment_screenshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS "booking_initial_payment_requires_screenshot"
    ON public."booking_initial_payment_requests";

CREATE TRIGGER "booking_initial_payment_requires_screenshot"
    BEFORE INSERT OR UPDATE OF "status", "screenshot_path"
    ON public."booking_initial_payment_requests"
    FOR EACH ROW
    EXECUTE FUNCTION public.require_booking_payment_screenshot();
