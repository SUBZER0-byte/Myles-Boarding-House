CREATE OR REPLACE FUNCTION public.enforce_guest_booking_gcash_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW."method" = 'GCash'
       AND NEW."status" = 'Submitted'
       AND NULLIF(btrim(NEW."reference_number"), '') IS NULL THEN
        RAISE EXCEPTION 'A GCash transaction reference is required';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_require_guest_booking_gcash_reference"
    ON public."booking_initial_payment_requests";
CREATE TRIGGER "trg_require_guest_booking_gcash_reference"
    BEFORE INSERT OR UPDATE OF "method", "status", "reference_number"
    ON public."booking_initial_payment_requests"
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_guest_booking_gcash_reference();
