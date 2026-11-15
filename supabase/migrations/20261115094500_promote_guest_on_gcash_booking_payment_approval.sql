CREATE OR REPLACE FUNCTION public.promote_booking_guest_to_tenant(booking_id_value integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    booking_row public."bookings"%ROWTYPE;
    user_row public."users"%ROWTYPE;
    tenant_row public."tenants"%ROWTYPE;
    tenant_id_value integer;
BEGIN
    SELECT b.* INTO booking_row
      FROM public."bookings" AS b
     WHERE b."booking_id" = booking_id_value
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking was not found for tenant account conversion';
    END IF;
    IF booking_row."guest_user_id" IS NULL THEN
        RAISE EXCEPTION 'No guest account is linked to this booking';
    END IF;
    IF booking_row."room_id" IS NULL OR booking_row."move_in_date" IS NULL THEN
        RAISE EXCEPTION 'Booking details are incomplete for tenant account conversion';
    END IF;

    SELECT u.* INTO user_row
      FROM public."users" AS u
     WHERE u."user_id" = booking_row."guest_user_id"
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The guest account linked to this booking was not found';
    END IF;
    IF user_row."user_type" = 'Admin' THEN
        RAISE EXCEPTION 'An administrator account cannot be converted to a tenant';
    END IF;

    SELECT t.* INTO tenant_row
      FROM public."tenants" AS t
     WHERE t."user_id" = booking_row."guest_user_id"
     ORDER BY t."is_active" DESC, t."tenant_id" DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
        IF tenant_row."is_active" = 1
           AND tenant_row."room_id" IS DISTINCT FROM booking_row."room_id" THEN
            RAISE EXCEPTION 'This account already has an active tenancy in another room';
        END IF;
        tenant_id_value := tenant_row."tenant_id";
        UPDATE public."tenants"
           SET "room_id" = booking_row."room_id",
               "reservation_type" = booking_row."reservation_type",
               "occupant_count" = booking_row."occupant_count",
               "full_name" = booking_row."full_name",
               "phone" = booking_row."phone",
               "email" = booking_row."email",
               "move_in_date" = booking_row."move_in_date",
               "move_out_date" = booking_row."check_out_date",
               "is_active" = 1
         WHERE "tenant_id" = tenant_id_value;
    ELSE
        INSERT INTO public."tenants" (
            "user_id", "room_id", "reservation_type", "occupant_count",
            "full_name", "phone", "email", "move_in_date", "move_out_date",
            "is_active", "created_at"
        ) VALUES (
            booking_row."guest_user_id", booking_row."room_id",
            booking_row."reservation_type", booking_row."occupant_count",
            booking_row."full_name", booking_row."phone", booking_row."email",
            booking_row."move_in_date", booking_row."check_out_date", 1, CURRENT_TIMESTAMP
        )
        RETURNING "tenant_id" INTO tenant_id_value;
    END IF;

    UPDATE public."users"
       SET "user_type" = 'Tenant'
     WHERE "user_id" = booking_row."guest_user_id";

    UPDATE public."payments"
       SET "tenant_id" = tenant_id_value
     WHERE "booking_id" = booking_row."booking_id"
       AND "tenant_id" IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_guest_booking_to_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.promote_booking_guest_to_tenant(NEW."booking_id");
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
BEGIN
    SELECT b."status" INTO booking_status_value
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
    ELSE
        RAISE EXCEPTION 'Booking status % cannot be confirmed', booking_status_value;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_booking_guest_to_tenant(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_guest_booking_to_tenant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_guest_on_gcash_payment_confirmation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_initial_payment_promote_guest_on_confirmation
    ON public."booking_initial_payment_requests";
CREATE TRIGGER booking_initial_payment_promote_guest_on_confirmation
AFTER UPDATE OF "status" ON public."booking_initial_payment_requests"
FOR EACH ROW
WHEN (
    OLD."status" IS DISTINCT FROM NEW."status"
    AND NEW."status" = 'Confirmed'
    AND NEW."method" = 'GCash'
)
EXECUTE FUNCTION public.promote_guest_on_gcash_payment_confirmation();
