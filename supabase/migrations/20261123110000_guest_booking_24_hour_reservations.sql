UPDATE public."bookings" AS b
   SET "payment_expires_at" =
       b."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours'
 WHERE b."status" IN ('Pending', 'Pending Verification')
   AND b."payment_expires_at" IS DISTINCT FROM
       b."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours';

UPDATE public."bookings" AS b
   SET "status" = 'Expired',
       "updated_at" = CURRENT_TIMESTAMP
 WHERE b."status" IN ('Pending', 'Pending Verification')
   AND b."payment_expires_at" <= CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION public.set_guest_booking_reservation_terms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW."guest_user_id" IS NOT NULL
       AND NEW."request_id" IS NOT NULL
       AND NEW."status" = 'Pending' THEN
        NEW."reservation_type" := 'capacity_based';
        NEW."occupant_count" := 1;
        NEW."payment_expires_at" := CURRENT_TIMESTAMP + interval '24 hours';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "bookings_set_guest_reservation_terms" ON public."bookings";
CREATE TRIGGER "bookings_set_guest_reservation_terms"
    BEFORE INSERT ON public."bookings"
    FOR EACH ROW
    EXECUTE FUNCTION public.set_guest_booking_reservation_terms();

CREATE OR REPLACE FUNCTION public.get_guest_booking_reservation_deadline(p_booking_id integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_guest_id integer;
    expiry timestamptz;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Guest' THEN
        RAISE EXCEPTION 'Guest access is required';
    END IF;

    SELECT u."user_id"
      INTO current_guest_id
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."user_type" = 'Guest'
       AND u."is_active" = 1
     LIMIT 1;

    SELECT b."payment_expires_at"
      INTO expiry
      FROM public."bookings" AS b
     WHERE b."booking_id" = p_booking_id
       AND b."guest_user_id" = current_guest_id
       AND b."status" IN ('Pending', 'Pending Verification');

    IF expiry IS NULL THEN
        RAISE EXCEPTION 'Active booking reservation was not found';
    END IF;

    RETURN jsonb_build_object(
        'payment_expires_at_epoch', extract(epoch FROM expiry)::bigint,
        'server_now_epoch', extract(epoch FROM CURRENT_TIMESTAMP)::bigint
    );
END;
$$;

REVOKE ALL ON FUNCTION public.set_guest_booking_reservation_terms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_guest_booking_reservation_deadline(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guest_booking_reservation_deadline(integer) TO authenticated;

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
               b."status" NOT IN ('Pending', 'Pending Verification')
               OR COALESCE(
                   b."payment_expires_at",
                   b."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours'
               ) > CURRENT_TIMESTAMP
           )
    );
$$;

REVOKE ALL ON FUNCTION public.guest_has_active_room_booking(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_has_active_room_booking(integer, integer, integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_expired_guest_booking_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF OLD."status" IN ('Pending', 'Pending Verification')
       AND NEW."status" IN ('Confirmed', 'Checked In', 'Active')
       AND COALESCE(
           OLD."payment_expires_at",
           OLD."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours'
       ) <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'This booking reservation has expired';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "bookings_prevent_expired_guest_confirmation" ON public."bookings";
CREATE TRIGGER "bookings_prevent_expired_guest_confirmation"
    BEFORE UPDATE OF "status" ON public."bookings"
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_expired_guest_booking_confirmation();

REVOKE ALL ON FUNCTION public.prevent_expired_guest_booking_confirmation() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_room_reservation_summary(p_room_id integer)
RETURNS TABLE (
    "reservation_count" bigint,
    "reservation_deadlines_epoch" jsonb,
    "server_now_epoch" bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(*)::bigint,
           COALESCE(
               jsonb_agg(
                   extract(epoch FROM COALESCE(
                       b."payment_expires_at",
                       b."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours'
                   ))::bigint
                   ORDER BY COALESCE(
                       b."payment_expires_at",
                       b."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours'
                   )
               ),
               '[]'::jsonb
           ),
           extract(epoch FROM CURRENT_TIMESTAMP)::bigint
      FROM public."bookings" AS b
     WHERE b."room_id" = p_room_id
       AND b."status" IN ('Pending', 'Pending Verification')
       AND COALESCE(
           b."payment_expires_at",
           b."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours'
       ) > CURRENT_TIMESTAMP;
$$;

REVOKE ALL ON FUNCTION public.get_room_reservation_summary(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_reservation_summary(integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_rooms_for_dates(
    p_check_in_date date,
    p_check_out_date date
)
RETURNS TABLE (
    "room_id" integer,
    "room_number" varchar(40),
    "room_type" varchar(80),
    "capacity" integer,
    "monthly_rent" numeric(10,2),
    "description" text,
    "status" text,
    "image" varchar(255),
    "occupants" bigint,
    "available_beds" bigint,
    "available_for_dates" boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_email text;
BEGIN
    IF p_check_in_date IS NULL OR p_check_out_date IS NULL
       OR p_check_in_date < CURRENT_DATE
       OR p_check_out_date <= p_check_in_date THEN
        RAISE EXCEPTION 'Choose a valid stay starting today or later';
    END IF;

    SELECT lower(btrim(u."email"))
      INTO caller_email
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."is_active" = 1
     LIMIT 1;

    RETURN QUERY
    WITH tenant_load AS (
        SELECT t."room_id",
               COALESCE(SUM(
                   CASE WHEN t."reservation_type" = 'entire_room' THEN r."capacity"
                        ELSE LEAST(GREATEST(t."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS beds
          FROM public."tenants" AS t
          INNER JOIN public."rooms" AS r ON r."room_id" = t."room_id"
         WHERE t."is_active" = 1
           AND t."move_in_date" < p_check_out_date
           AND COALESCE(t."move_out_date", '9999-12-31'::date) > p_check_in_date
         GROUP BY t."room_id"
    ),
    booking_load AS (
        SELECT b."room_id",
               COALESCE(SUM(
                   CASE WHEN b."reservation_type" = 'entire_room' THEN r."capacity"
                        ELSE LEAST(GREATEST(b."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS beds
          FROM public."bookings" AS b
          INNER JOIN public."rooms" AS r ON r."room_id" = b."room_id"
         WHERE b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND (
               b."status" NOT IN ('Pending', 'Pending Verification')
               OR COALESCE(
                   b."payment_expires_at",
                   b."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours'
               ) > CURRENT_TIMESTAMP
           )
           AND b."move_in_date" < p_check_out_date
           AND b."check_out_date" > p_check_in_date
           AND NOT EXISTS (
               SELECT 1
                 FROM public."tenants" AS t
                WHERE t."room_id" = b."room_id"
                  AND t."is_active" = 1
                  AND lower(btrim(t."email")) = lower(btrim(b."email"))
                  AND t."move_in_date" < b."check_out_date"
                  AND COALESCE(t."move_out_date", '9999-12-31'::date) > b."move_in_date"
           )
         GROUP BY b."room_id"
    ),
    holds AS (
        SELECT h."room_id",
               COALESCE(SUM(
                   CASE WHEN h."reservation_type" = 'entire_room' THEN r."capacity"
                        ELSE LEAST(GREATEST(h."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS beds
          FROM public."booking_room_holds" AS h
          INNER JOIN public."rooms" AS r ON r."room_id" = h."room_id"
         WHERE h."expires_at" > CURRENT_TIMESTAMP
           AND (caller_email IS NULL OR lower(btrim(h."email")) <> caller_email)
           AND (h."move_in_date" IS NULL OR h."check_out_date" IS NULL
                OR (h."move_in_date" < p_check_out_date AND h."check_out_date" > p_check_in_date))
         GROUP BY h."room_id"
    ),
    occupancy AS (
        SELECT r."room_id",
               COALESCE(tl.beds, 0) + COALESCE(bl.beds, 0) + COALESCE(h.beds, 0) AS occupied
          FROM public."rooms" AS r
          LEFT JOIN tenant_load AS tl ON tl."room_id" = r."room_id"
          LEFT JOIN booking_load AS bl ON bl."room_id" = r."room_id"
          LEFT JOIN holds AS h ON h."room_id" = r."room_id"
    )
    SELECT r."room_id",
           r."room_number",
           r."room_type",
           r."capacity",
           r."monthly_rent",
           r."description",
           CASE
               WHEN r."status" = 'Maintenance' THEN 'Maintenance'
               WHEN o.occupied >= r."capacity" AND r."capacity" > 0 THEN 'Occupied'
               WHEN r."status" = 'Reserved' THEN 'Reserved'
               ELSE 'Available'
           END,
           r."image",
           o.occupied,
           GREATEST(r."capacity" - o.occupied, 0)::bigint,
           r."status" <> 'Maintenance' AND o.occupied < r."capacity"
      FROM public."rooms" AS r
      INNER JOIN occupancy AS o ON o."room_id" = r."room_id"
     ORDER BY r."room_number" ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_rooms_for_dates(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_for_dates(date, date) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_public_rooms_for_guest_browse_with_booking_state(date, date);
CREATE FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(
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
    "has_active_booking" boolean,
    "reservation_count" bigint,
    "reservation_deadlines_epoch" jsonb,
    "reservation_server_now_epoch" bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_guest_id integer;
BEGIN
    IF p_check_in_date IS NULL OR p_check_out_date IS NULL
       OR p_check_out_date <= p_check_in_date
       OR p_check_in_date < CURRENT_DATE THEN
        RAISE EXCEPTION 'Choose a valid stay starting today or later';
    END IF;

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
           public.guest_has_active_room_booking(current_guest_id, availability."room_id"),
           reservations."reservation_count",
           reservations."reservation_deadlines_epoch",
           reservations."server_now_epoch"
      FROM public.get_public_rooms_for_dates(p_check_in_date, p_check_out_date) AS availability
      JOIN public."rooms" AS r ON r."room_id" = availability."room_id"
      CROSS JOIN LATERAL public.get_room_reservation_summary(availability."room_id") AS reservations
     ORDER BY availability."room_number" ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(date, date) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_admin_rooms()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    result jsonb;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    SELECT COALESCE(jsonb_agg(room_row ORDER BY room_number), '[]'::jsonb)
      INTO result
      FROM (
          SELECT r."room_number",
                 jsonb_build_object(
                     'room_id', r."room_id",
                     'room_number', r."room_number",
                     'floor_number', r."floor_number",
                     'room_type', r."room_type",
                     'capacity', r."capacity",
                     'occupants', COALESCE(tenant_load."occupants", 0),
                     'available_beds', availability."available_beds",
                     'reservation_count', reservations."reservation_count",
                     'reservation_deadlines_epoch', reservations."reservation_deadlines_epoch",
                     'reservation_server_now_epoch', reservations."server_now_epoch",
                     'occupant_genders', public.get_room_occupant_genders(r."room_id"),
                     'monthly_rent', r."monthly_rent",
                     'status', availability."status",
                     'description', r."description",
                     'image', r."image"
                 ) AS room_row
            FROM public."rooms" AS r
            JOIN LATERAL (
                SELECT a."status", a."available_beds"
                  FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS a
                 WHERE a."room_id" = r."room_id"
            ) AS availability ON true
            CROSS JOIN LATERAL public.get_room_reservation_summary(r."room_id") AS reservations
            LEFT JOIN LATERAL (
                SELECT count(*)::integer AS occupants
                  FROM public."tenants" AS t
                 WHERE t."room_id" = r."room_id"
                   AND t."is_active" = 1
                   AND t."move_in_date" <= CURRENT_DATE
                   AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
            ) AS tenant_load ON true
      ) AS rooms;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_rooms() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_guest_booking_boundary_dates(
    p_room_id integer,
    p_from date,
    p_until date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    unavailable jsonb;
BEGIN
    IF p_room_id IS NULL
       OR p_from IS NULL
       OR p_until IS NULL
       OR p_until <= p_from
       OR p_until > p_from + 366 THEN
        RAISE EXCEPTION 'Choose a valid room date range';
    END IF;

    WITH exact_dates AS (
        SELECT t."move_in_date" AS day
          FROM public."tenants" AS t
         WHERE t."is_active" = 1
           AND t."move_in_date" BETWEEN p_from AND p_until
        UNION
        SELECT t."move_out_date" AS day
          FROM public."tenants" AS t
         WHERE t."is_active" = 1
           AND t."move_out_date" BETWEEN p_from AND p_until
        UNION
        SELECT b."move_in_date" AS day
          FROM public."bookings" AS b
         WHERE b."status" IN ('Pending', 'Pending Verification')
           AND COALESCE(
               b."payment_expires_at",
               b."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours'
           ) > CURRENT_TIMESTAMP
           AND b."move_in_date" BETWEEN p_from AND p_until
        UNION
        SELECT b."check_out_date" AS day
          FROM public."bookings" AS b
         WHERE b."status" IN ('Pending', 'Pending Verification')
           AND COALESCE(
               b."payment_expires_at",
               b."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours'
           ) > CURRENT_TIMESTAMP
           AND b."check_out_date" BETWEEN p_from AND p_until
    )
    SELECT COALESCE(jsonb_agg(day::text ORDER BY day), '[]'::jsonb)
      INTO unavailable
      FROM exact_dates;

    RETURN unavailable;
END;
$$;

REVOKE ALL ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) TO authenticated;
