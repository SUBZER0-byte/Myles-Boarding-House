CREATE OR REPLACE FUNCTION public.promote_guest_booking_to_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.promote_booking_guest_to_tenant(NEW."booking_id");

    UPDATE public."rooms" AS target
       SET "status" = availability."status"
      FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS availability
     WHERE target."room_id" = NEW."room_id"
       AND availability."room_id" = NEW."room_id";

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_guest_on_gcash_payment_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    booking_status_value text;
    room_id_value integer;
BEGIN
    SELECT b."status", b."room_id"
      INTO booking_status_value, room_id_value
      FROM public."bookings" AS b
     WHERE b."booking_id" = NEW."booking_id"
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking was not found for payment confirmation';
    END IF;

    IF booking_status_value IN ('Pending', 'Pending Verification') THEN
        UPDATE public."bookings"
           SET "status" = 'Confirmed',
               "updated_at" = CURRENT_TIMESTAMP
         WHERE "booking_id" = NEW."booking_id"
           AND "status" IN ('Pending', 'Pending Verification');
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Booking status changed during payment confirmation';
        END IF;
    ELSIF booking_status_value IN ('Confirmed', 'Checked In', 'Active') THEN
        PERFORM public.promote_booking_guest_to_tenant(NEW."booking_id");

        UPDATE public."rooms" AS target
           SET "status" = availability."status"
          FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS availability
         WHERE target."room_id" = room_id_value
           AND availability."room_id" = room_id_value;
    ELSE
        RAISE EXCEPTION 'Booking status % cannot be confirmed', booking_status_value;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_guest_booking_to_tenant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_guest_on_gcash_payment_confirmation() FROM PUBLIC, anon, authenticated;
