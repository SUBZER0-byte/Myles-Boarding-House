CREATE OR REPLACE FUNCTION public.get_room_occupant_genders(p_room_id integer)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        array_agg(
            DISTINCT COALESCE(NULLIF(u."gender", ''), 'Not provided')
            ORDER BY COALESCE(NULLIF(u."gender", ''), 'Not provided')
        ),
        ARRAY[]::text[]
    )
      FROM public."tenants" AS t
      LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
     WHERE t."room_id" = p_room_id
       AND t."is_active" = 1
       AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE;
$$;

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
                     'available_beds', GREATEST(
                         r."capacity" - COALESCE(tenant_load."occupant_beds", 0),
                         0
                     ),
                     'occupant_genders', public.get_room_occupant_genders(r."room_id"),
                     'monthly_rent', r."monthly_rent",
                     'status', CASE
                         WHEN r."status" = 'Maintenance' THEN 'Maintenance'
                         WHEN COALESCE(tenant_load."occupant_beds", 0) >= r."capacity" THEN 'Occupied'
                         WHEN r."status" = 'Reserved' THEN 'Reserved'
                         ELSE 'Available'
                     END,
                     'description', r."description",
                     'image', r."image"
                 ) AS room_row
            FROM public."rooms" AS r
            LEFT JOIN LATERAL (
                SELECT count(*)::integer AS occupants,
                       COALESCE(SUM(
                           CASE WHEN t."reservation_type" = 'entire_room' THEN r."capacity"
                                ELSE LEAST(GREATEST(t."occupant_count", 1), r."capacity") END
                       ), 0)::integer AS occupant_beds
                  FROM public."tenants" AS t
                 WHERE t."room_id" = r."room_id"
                   AND t."is_active" = 1
                   AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
            ) AS tenant_load ON true
      ) AS rooms;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_room_occupant_genders(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_admin_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_room_occupant_genders(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_admin_rooms() TO authenticated;

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
    SELECT r."room_id",
           r."room_number",
           r."floor_number",
           r."capacity",
           r."monthly_rent",
           r."description",
           CASE
             WHEN r."status" = 'Maintenance' THEN 'Maintenance'
             WHEN COALESCE(tenant_load.tenant_beds, 0) >= r."capacity" THEN 'Occupied'
             WHEN r."status" = 'Reserved' THEN 'Reserved'
             ELSE 'Available'
           END AS "status",
           r."image",
           COALESCE(tenant_load.occupants, 0)::bigint,
           GREATEST(
             r."capacity" - COALESCE(tenant_load.tenant_beds, 0),
             0
           )::bigint,
           CASE
             WHEN r."status" = 'Maintenance' THEN false
             ELSE (
               r."capacity" - COALESCE(tenant_load.tenant_beds, 0)
             ) > 0
           END,
           public.get_room_occupant_genders(r."room_id"),
           public.guest_has_active_room_booking(current_guest_id, r."room_id")
      FROM public."rooms" AS r
      LEFT JOIN LATERAL (
        SELECT count(*)::bigint AS occupants,
               COALESCE(SUM(
                 CASE WHEN t."reservation_type" = 'entire_room' THEN r."capacity"
                      ELSE LEAST(GREATEST(t."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS tenant_beds
          FROM public."tenants" AS t
         WHERE t."room_id" = r."room_id"
           AND t."is_active" = 1
           AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
      ) AS tenant_load ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(
                 CASE WHEN b."reservation_type" = 'entire_room' THEN r."capacity"
                      ELSE LEAST(GREATEST(b."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS booking_beds
          FROM public."bookings" AS b
         WHERE b."room_id" = r."room_id"
           AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND b."move_in_date" < p_check_out_date
           AND b."check_out_date" > p_check_in_date
           AND NOT EXISTS (
             SELECT 1
               FROM public."tenants" AS t
              WHERE t."room_id" = b."room_id"
                AND t."is_active" = 1
                AND lower(btrim(t."email")) = lower(btrim(b."email"))
           )
      ) AS booking_load ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(
                 CASE WHEN h."reservation_type" = 'entire_room' THEN r."capacity"
                      ELSE LEAST(GREATEST(h."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS hold_beds
          FROM public."booking_room_holds" AS h
         WHERE h."room_id" = r."room_id"
           AND h."expires_at" > CURRENT_TIMESTAMP
           AND (
             h."move_in_date" IS NULL
             OR h."check_out_date" IS NULL
             OR (h."move_in_date" < p_check_out_date AND h."check_out_date" > p_check_in_date)
           )
      ) AS hold_load ON true
     ORDER BY r."room_number" ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(date, date) TO anon, authenticated;
