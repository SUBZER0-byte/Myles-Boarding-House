CREATE OR REPLACE FUNCTION public.get_room_occupant_genders(p_room_id integer)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        array_agg(
            COALESCE(NULLIF(u."gender", ''), 'Not provided')::text
            ORDER BY COALESCE(t."move_in_date", CURRENT_DATE), t."tenant_id"
        ),
        ARRAY[]::text[]
    )
      FROM public."tenants" AS t
      LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
     WHERE t."room_id" = p_room_id
       AND t."is_active" = 1
       AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE;
$$;

CREATE OR REPLACE FUNCTION public.get_room_gender_assignment(p_room_id integer)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH room_occupants AS (
        SELECT NULLIF(btrim(u."gender"), '') AS gender,
               COALESCE(t."move_in_date", CURRENT_DATE) AS occupancy_date,
               0 AS source_order,
               t."tenant_id"::bigint AS source_id
          FROM public."tenants" AS t
          LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
         WHERE t."room_id" = p_room_id
           AND t."is_active" = 1
           AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE

        UNION ALL

        SELECT NULLIF(btrim(u."gender"), ''),
               COALESCE(b."move_in_date", CURRENT_DATE),
               1,
               b."booking_id"::bigint
          FROM public."bookings" AS b
          LEFT JOIN public."users" AS u
            ON u."user_id" = b."guest_user_id"
            OR (
                b."guest_user_id" IS NULL
                AND lower(btrim(u."email")) = lower(btrim(b."email"))
                AND u."user_type" = 'Guest'
            )
         WHERE b."room_id" = p_room_id
           AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND COALESCE(b."check_out_date", '9999-12-31'::date) > CURRENT_DATE
           AND (
               b."status" <> 'Pending'
               OR b."payment_expires_at" IS NULL
               OR b."payment_expires_at" > CURRENT_TIMESTAMP
           )
           AND NOT EXISTS (
               SELECT 1
                 FROM public."tenants" AS t
                WHERE t."room_id" = b."room_id"
                  AND t."is_active" = 1
                  AND lower(btrim(t."email")) = lower(btrim(b."email"))
           )

        UNION ALL

        SELECT NULLIF(btrim(u."gender"), ''),
               COALESCE(h."move_in_date", CURRENT_DATE),
               2,
               h."hold_id"
          FROM public."booking_room_holds" AS h
          LEFT JOIN public."users" AS u ON u."user_id" = h."user_id"
         WHERE h."room_id" = p_room_id
           AND h."expires_at" > CURRENT_TIMESTAMP
           AND COALESCE(h."check_out_date", '9999-12-31'::date) > CURRENT_DATE
    )
    SELECT gender
      FROM room_occupants
     WHERE gender IN ('Male', 'Female')
     ORDER BY occupancy_date, source_order, source_id
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.enforce_room_gender_compatibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    room_id_value integer;
    user_id_value integer;
    user_gender text;
    first_occupant_gender text;
    locked_room_id integer;
BEGIN
    IF TG_TABLE_NAME = 'bookings' THEN
        IF NEW."status" NOT IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active') THEN
            RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE'
           AND OLD."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND NEW."room_id" IS NOT DISTINCT FROM OLD."room_id"
           AND NEW."guest_user_id" IS NOT DISTINCT FROM OLD."guest_user_id"
           AND NEW."move_in_date" IS NOT DISTINCT FROM OLD."move_in_date"
           AND NEW."check_out_date" IS NOT DISTINCT FROM OLD."check_out_date" THEN
            RETURN NEW;
        END IF;
        room_id_value := NEW."room_id";
        user_id_value := NEW."guest_user_id";
    ELSE
        IF NEW."expires_at" <= CURRENT_TIMESTAMP THEN
            RETURN NEW;
        END IF;
        room_id_value := NEW."room_id";
        user_id_value := NEW."user_id";
    END IF;

    IF room_id_value IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT r."room_id"
      INTO locked_room_id
      FROM public."rooms" AS r
     WHERE r."room_id" = room_id_value
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This room is unavailable';
    END IF;

    IF user_id_value IS NOT NULL THEN
        SELECT NULLIF(btrim(u."gender"), '')
          INTO user_gender
          FROM public."users" AS u
         WHERE u."user_id" = user_id_value;
    ELSIF TG_TABLE_NAME = 'bookings' THEN
        SELECT NULLIF(btrim(u."gender"), '')
          INTO user_gender
          FROM public."users" AS u
         WHERE lower(btrim(u."email")) = lower(btrim(NEW."email"))
           AND u."user_type" = 'Guest'
         LIMIT 1;
    END IF;

    IF user_gender IS NULL OR user_gender NOT IN ('Male', 'Female') THEN
        RETURN NEW;
    END IF;

    SELECT public.get_room_gender_assignment(room_id_value)
      INTO first_occupant_gender;

    IF first_occupant_gender IS NOT NULL
       AND first_occupant_gender <> user_gender THEN
        RAISE EXCEPTION 'This room is reserved for % occupants and cannot be booked by a % guest',
            first_occupant_gender, user_gender;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_gender_compatibility ON public."bookings";
CREATE TRIGGER bookings_gender_compatibility
BEFORE INSERT OR UPDATE OF "room_id", "guest_user_id", "move_in_date", "check_out_date", "status"
ON public."bookings"
FOR EACH ROW
EXECUTE FUNCTION public.enforce_room_gender_compatibility();

DROP TRIGGER IF EXISTS booking_room_holds_gender_compatibility ON public."booking_room_holds";
CREATE TRIGGER booking_room_holds_gender_compatibility
BEFORE INSERT OR UPDATE
ON public."booking_room_holds"
FOR EACH ROW
EXECUTE FUNCTION public.enforce_room_gender_compatibility();

REVOKE ALL ON FUNCTION public.get_room_occupant_genders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_occupant_genders(integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_room_gender_assignment(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_room_gender_compatibility() FROM PUBLIC, anon, authenticated;
