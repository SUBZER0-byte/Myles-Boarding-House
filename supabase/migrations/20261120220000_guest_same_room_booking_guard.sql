CREATE OR REPLACE FUNCTION public.guest_has_active_room_booking(
    p_guest_user_id integer,
    p_room_id integer,
    p_exclude_booking_id integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public."bookings" AS b
         WHERE b."guest_user_id" = p_guest_user_id
           AND b."room_id" = p_room_id
           AND (p_exclude_booking_id IS NULL OR b."booking_id" <> p_exclude_booking_id)
           AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND (
               b."status" <> 'Pending'
               OR b."payment_expires_at" > CURRENT_TIMESTAMP
               OR EXISTS (
                   SELECT 1
                     FROM public."booking_initial_payment_requests" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."status" IN ('Submitted', 'Confirmed')
               )
               OR EXISTS (
                   SELECT 1
                     FROM public."payments" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."payment_type" = CASE
                          WHEN b."payment_plan" = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                          ELSE 'Security Deposit'
                      END
                      AND ip."status" IN ('Submitted', 'Confirmed', 'Paid')
               )
           )
    );
$$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_guest_room_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    excluded_booking_id integer;
BEGIN
    IF NEW."guest_user_id" IS NULL
       OR NEW."room_id" IS NULL
       OR NEW."status" NOT IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active') THEN
        RETURN NEW;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(NEW."guest_user_id"::bigint);
    IF TG_OP = 'UPDATE' THEN
        excluded_booking_id := OLD."booking_id";
    END IF;

    IF public.guest_has_active_room_booking(
        NEW."guest_user_id",
        NEW."room_id",
        excluded_booking_id
    ) THEN
        RAISE EXCEPTION 'You already have an active booking for this room';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_hold_for_booked_guest_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(NEW."user_id"::bigint);
    IF public.guest_has_active_room_booking(NEW."user_id", NEW."room_id") THEN
        RAISE EXCEPTION 'You already have an active booking for this room';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "bookings_prevent_duplicate_guest_room_active" ON public."bookings";
CREATE TRIGGER "bookings_prevent_duplicate_guest_room_active"
    BEFORE INSERT OR UPDATE OF "guest_user_id", "room_id", "status"
    ON public."bookings"
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_duplicate_guest_room_booking();

DROP TRIGGER IF EXISTS "booking_holds_prevent_duplicate_guest_room" ON public."booking_room_holds";
CREATE TRIGGER "booking_holds_prevent_duplicate_guest_room"
    BEFORE INSERT OR UPDATE OF "user_id", "room_id"
    ON public."booking_room_holds"
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_hold_for_booked_guest_room();

CREATE OR REPLACE FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(
    p_check_in_date date,
    p_check_out_date date
)
RETURNS TABLE (
    "room_id" integer,
    "room_number" varchar(40),
    "floor_number" smallint,
    "capacity" integer,
    "monthly_rent" numeric(10,2),
    "description" text,
    "status" text,
    "image" varchar(255),
    "occupants" bigint,
    "available_beds" bigint,
    "available_for_dates" boolean,
    "occupant_genders" text[],
    "has_active_booking" boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_guest_id integer;
BEGIN
    SELECT u."user_id"
      INTO current_guest_id
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."user_type" = 'Guest'
       AND u."is_active" = 1
     LIMIT 1;

    RETURN QUERY
    SELECT availability."room_id",
           availability."room_number",
           r."floor_number",
           availability."capacity",
           availability."monthly_rent",
           availability."description",
           availability."status",
           availability."image",
           availability."occupants",
           availability."available_beds",
           availability."available_for_dates",
           public.get_room_occupant_genders(availability."room_id"),
           public.guest_has_active_room_booking(current_guest_id, availability."room_id")
      FROM public.get_public_rooms_for_guest_browse(p_check_in_date, p_check_out_date) AS availability
      JOIN public."rooms" AS r ON r."room_id" = availability."room_id"
     ORDER BY availability."room_number" ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_has_active_room_booking(integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_duplicate_guest_room_booking() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_hold_for_booked_guest_room() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(date, date) TO anon, authenticated;
