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
       AND t."move_in_date" <= CURRENT_DATE
       AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE;
$$;

CREATE OR REPLACE FUNCTION public.get_public_rooms_with_occupant_genders()
RETURNS TABLE (
    "room_id" integer,
    "room_number" varchar(40),
    "room_type" varchar(80),
    "capacity" integer,
    "monthly_rent" numeric(10,2),
    "description" text,
    "status" text,
    "image" varchar(255),
    "occupant_genders" text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT room."room_id",
           room."room_number",
           room."room_type",
           room."capacity",
           room."monthly_rent",
           room."description",
           room."status",
           room."image",
           public.get_room_occupant_genders(room."room_id")
      FROM public.get_public_rooms() AS room
     ORDER BY room."room_number" ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_public_rooms_for_guest_browse_with_occupant_genders(
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
    "available_for_dates" boolean,
    "occupant_genders" text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT room."room_id",
           room."room_number",
           room."room_type",
           room."capacity",
           room."monthly_rent",
           room."description",
           room."status",
           room."image",
           room."occupants",
           room."available_beds",
           room."available_for_dates",
           public.get_room_occupant_genders(room."room_id")
      FROM public.get_public_rooms_for_guest_browse(p_check_in_date, p_check_out_date) AS room
     ORDER BY room."room_number" ASC;
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
                     'room_type', r."room_type",
                     'capacity', r."capacity",
                     'monthly_rent', r."monthly_rent",
                     'status', CASE
                         WHEN r."status" = 'Maintenance' THEN 'Maintenance'
                         WHEN availability."status" = 'Occupied' THEN 'Occupied'
                         WHEN EXISTS (
                             SELECT 1
                               FROM public."bookings" AS b
                              WHERE b."room_id" = r."room_id"
                                AND b."status" IN ('Confirmed', 'Checked In', 'Active')
                                AND b."check_out_date" > CURRENT_DATE
                         ) THEN 'Occupied'
                         ELSE COALESCE(availability."status", r."status")
                     END,
                     'description', r."description",
                     'image', r."image",
                     'occupants', (
                         SELECT count(*)::integer
                           FROM public."tenants" AS t
                          WHERE t."room_id" = r."room_id"
                            AND t."is_active" = 1
                            AND t."move_in_date" <= CURRENT_DATE
                            AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
                     ),
                     'occupant_genders', public.get_room_occupant_genders(r."room_id")
                 ) AS room_row
            FROM public."rooms" AS r
            LEFT JOIN LATERAL (
                SELECT a."status"
                  FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS a
                 WHERE a."room_id" = r."room_id"
            ) AS availability ON true
      ) AS rooms;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_room_occupant_genders(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_rooms_with_occupant_genders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_rooms_for_guest_browse_with_occupant_genders(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_admin_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_with_occupant_genders() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_for_guest_browse_with_occupant_genders(date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_admin_rooms() TO authenticated;
