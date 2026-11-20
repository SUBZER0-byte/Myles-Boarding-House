ALTER TABLE public."rooms"
    ADD COLUMN IF NOT EXISTS "floor_number" smallint NOT NULL DEFAULT 1;

ALTER TABLE public."rooms"
    ALTER COLUMN "floor_number" SET DEFAULT 1,
    ALTER COLUMN "floor_number" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public."rooms"'::regclass
           AND conname = 'rooms_floor_number_positive'
    ) THEN
        ALTER TABLE public."rooms"
            ADD CONSTRAINT "rooms_floor_number_positive"
            CHECK ("floor_number" BETWEEN 1 AND 32767);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_rooms_with_floor()
RETURNS TABLE (
    "room_id" integer,
    "room_number" varchar(40),
    "floor_number" smallint,
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
           r."floor_number",
           room."capacity",
           room."monthly_rent",
           room."description",
           room."status",
           room."image",
           public.get_room_occupant_genders(room."room_id")
      FROM public.get_public_rooms() AS room
      JOIN public."rooms" AS r ON r."room_id" = room."room_id"
     ORDER BY room."room_number" ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_public_rooms_for_guest_browse_with_floor(
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
    "occupant_genders" text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
           public.get_room_occupant_genders(availability."room_id")
      FROM public.get_public_rooms_for_guest_browse(p_check_in_date, p_check_out_date) AS availability
      JOIN public."rooms" AS r ON r."room_id" = availability."room_id"
     ORDER BY availability."room_number" ASC;
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

CREATE OR REPLACE FUNCTION public.save_my_admin_room_with_floor(
    p_room_id integer,
    p_room_number text,
    p_floor_number smallint,
    p_capacity integer,
    p_monthly_rent numeric,
    p_status text,
    p_description text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    legacy_room_type text;
    saved_room_id integer;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_floor_number IS NULL OR p_floor_number < 1 OR p_floor_number > 32767 THEN
        RAISE EXCEPTION 'Floor number must be a whole number from 1 to 32767';
    END IF;

    IF p_room_id IS NOT NULL THEN
        SELECT r."room_type"
          INTO legacy_room_type
          FROM public."rooms" AS r
         WHERE r."room_id" = p_room_id;
    END IF;

    saved_room_id := public.save_my_admin_room(
        p_room_id,
        p_room_number,
        COALESCE(legacy_room_type, 'Unspecified'),
        p_capacity,
        p_monthly_rent,
        p_status,
        p_description
    );

    UPDATE public."rooms"
       SET "floor_number" = p_floor_number
     WHERE "room_id" = saved_room_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room not found after saving';
    END IF;

    RETURN saved_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_tenants()
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

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'tenant_id', t."tenant_id",
                'user_id', t."user_id",
                'room_id', t."room_id",
                'full_name', t."full_name",
                'username', u."username",
                'phone', t."phone",
                'email', t."email",
                'address', u."address",
                'age', u."age",
                'birthday', u."birthday",
                'gender', u."gender",
                'emergency_contact_name', u."emergency_contact_name",
                'emergency_contact_phone', u."emergency_contact_phone",
                'move_in_date', t."move_in_date",
                'move_out_date', t."move_out_date",
                'is_active', t."is_active",
                'room_number', r."room_number",
                'floor_number', r."floor_number",
                'profile_picture', u."profile_picture"
            )
            ORDER BY t."full_name"
        ),
        '[]'::jsonb
    )
      INTO result
      FROM public."tenants" AS t
      LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
      LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
     WHERE t."deleted_at" IS NULL;

    RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_tenant_room()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH current_tenant AS (
        SELECT t."tenant_id", t."user_id", t."room_id", t."full_name" AS "tenant_name",
               t."email" AS "tenant_email", t."move_in_date", t."move_out_date",
               u."email" AS "user_email"
        FROM public."tenants" AS t
        INNER JOIN public."users" AS u ON u."user_id" = t."user_id"
        WHERE u."auth_user_id" = auth.uid()
          AND u."user_type" = 'Tenant'
          AND u."is_active" = 1
          AND t."is_active" = 1
        ORDER BY t."tenant_id" DESC
        LIMIT 1
    )
    SELECT jsonb_build_object(
        'room_id', r."room_id",
        'room_number', r."room_number",
        'floor_number', r."floor_number",
        'capacity', r."capacity",
        'monthly_rent', r."monthly_rent",
        'status', r."status",
        'description', r."description",
        'tenant_id', t."tenant_id",
        'tenant_name', t."tenant_name",
        'move_in_date', t."move_in_date",
        'move_out_date', t."move_out_date",
        'booking_id', booking."booking_id",
        'check_out_date', booking."check_out_date",
        'requested_move_out_date', (
            SELECT stay_change."requested_check_out_date"
            FROM public."stay_change_requests" AS stay_change
            WHERE stay_change."booking_id" = booking."booking_id"
              AND stay_change."request_type" = 'Extension'
              AND stay_change."status" = 'Pending'
            ORDER BY stay_change."created_at" DESC, stay_change."request_id" DESC
            LIMIT 1
        ),
        'extension_request_status', (
            SELECT stay_change."status"
            FROM public."stay_change_requests" AS stay_change
            WHERE stay_change."booking_id" = booking."booking_id"
              AND stay_change."request_type" = 'Extension'
            ORDER BY stay_change."created_at" DESC, stay_change."request_id" DESC
            LIMIT 1
        )
    )
    FROM current_tenant AS t
    INNER JOIN public."rooms" AS r ON r."room_id" = t."room_id"
    LEFT JOIN LATERAL (
        SELECT b."booking_id", b."check_out_date"
        FROM public."bookings" AS b
        WHERE b."room_id" = t."room_id"
          AND b."status" IN ('Confirmed', 'Checked In', 'Active')
          AND (
              (NULLIF(btrim(t."user_email"), '') IS NOT NULL
               AND lower(btrim(b."email")) = lower(btrim(t."user_email")))
              OR (NULLIF(btrim(t."tenant_email"), '') IS NOT NULL
                  AND lower(btrim(b."email")) = lower(btrim(t."tenant_email")))
          )
        ORDER BY b."created_at" DESC, b."booking_id" DESC
        LIMIT 1
    ) AS booking ON true;
$$;

REVOKE ALL ON FUNCTION public.get_public_rooms_with_floor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_rooms_for_guest_browse_with_floor(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_my_admin_room_with_floor(integer, text, smallint, integer, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_admin_tenants() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_tenant_room() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_with_floor() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_for_guest_browse_with_floor(date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_admin_room_with_floor(integer, text, smallint, integer, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_room() TO authenticated;
