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
               (
                   b."status" IN ('Pending', 'Pending Verification')
                   AND COALESCE(
                       b."payment_expires_at",
                       b."created_at" AT TIME ZONE 'Asia/Manila' + interval '24 hours'
                   ) > CURRENT_TIMESTAMP
               )
               OR (
                   b."status" IN ('Confirmed', 'Checked In', 'Active')
                   AND b."move_in_date" < p_check_out_date
                   AND b."check_out_date" > p_check_in_date
               )
           )
           AND NOT EXISTS (
               SELECT 1
                 FROM public."tenants" AS t
                WHERE t."room_id" = b."room_id"
                  AND t."is_active" = 1
                  AND lower(btrim(t."email")) = lower(btrim(b."email"))
                  AND COALESCE(t."move_out_date", '9999-12-31'::date) > p_check_in_date
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
                   AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
            ) AS tenant_load ON true
      ) AS rooms;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_rooms() TO authenticated;
