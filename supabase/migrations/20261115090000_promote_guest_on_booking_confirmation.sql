CREATE OR REPLACE FUNCTION public.promote_guest_booking_to_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_row public."users"%ROWTYPE;
    tenant_row public."tenants"%ROWTYPE;
    tenant_id_value integer;
BEGIN
    IF NEW."guest_user_id" IS NULL THEN
        RAISE EXCEPTION 'No guest account is linked to this booking';
    END IF;
    IF NEW."room_id" IS NULL OR NEW."move_in_date" IS NULL THEN
        RAISE EXCEPTION 'Booking details are incomplete for tenant account conversion';
    END IF;

    SELECT u.* INTO user_row
      FROM public."users" AS u
     WHERE u."user_id" = NEW."guest_user_id"
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The guest account linked to this booking was not found';
    END IF;
    IF user_row."user_type" = 'Admin' THEN
        RAISE EXCEPTION 'An administrator account cannot be converted to a tenant';
    END IF;

    SELECT t.* INTO tenant_row
      FROM public."tenants" AS t
     WHERE t."user_id" = NEW."guest_user_id"
     ORDER BY t."is_active" DESC, t."tenant_id" DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
        IF tenant_row."is_active" = 1
           AND tenant_row."room_id" IS DISTINCT FROM NEW."room_id" THEN
            RAISE EXCEPTION 'This account already has an active tenancy in another room';
        END IF;
        tenant_id_value := tenant_row."tenant_id";
        UPDATE public."tenants"
           SET "room_id" = NEW."room_id",
               "reservation_type" = NEW."reservation_type",
               "occupant_count" = NEW."occupant_count",
               "full_name" = NEW."full_name",
               "phone" = NEW."phone",
               "email" = NEW."email",
               "move_in_date" = NEW."move_in_date",
               "move_out_date" = NEW."check_out_date",
               "is_active" = 1
         WHERE "tenant_id" = tenant_id_value;
    ELSE
        INSERT INTO public."tenants" (
            "user_id", "room_id", "reservation_type", "occupant_count",
            "full_name", "phone", "email", "move_in_date", "move_out_date",
            "is_active", "created_at"
        ) VALUES (
            NEW."guest_user_id", NEW."room_id", NEW."reservation_type", NEW."occupant_count",
            NEW."full_name", NEW."phone", NEW."email", NEW."move_in_date", NEW."check_out_date",
            1, CURRENT_TIMESTAMP
        )
        RETURNING "tenant_id" INTO tenant_id_value;
    END IF;

    UPDATE public."users"
       SET "user_type" = 'Tenant'
     WHERE "user_id" = NEW."guest_user_id";

    UPDATE public."payments"
       SET "tenant_id" = tenant_id_value
     WHERE "booking_id" = NEW."booking_id"
       AND "tenant_id" IS NULL;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_guest_booking_to_tenant() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER bookings_promote_guest_on_confirmation
AFTER UPDATE OF "status" ON public."bookings"
FOR EACH ROW
WHEN (OLD."status" IS DISTINCT FROM NEW."status" AND NEW."status" = 'Confirmed')
EXECUTE FUNCTION public.promote_guest_booking_to_tenant();
