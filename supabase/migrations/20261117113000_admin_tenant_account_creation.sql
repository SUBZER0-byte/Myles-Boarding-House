CREATE OR REPLACE FUNCTION public.create_admin_tenant_from_guest(
    p_user_id integer,
    p_room_id integer,
    p_move_in_date date,
    p_move_out_date date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    guest_row public."users"%ROWTYPE;
    room_status text;
    available_beds bigint;
    tenant_id_value integer;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_user_id IS NULL OR p_user_id <= 0
       OR p_room_id IS NULL OR p_room_id <= 0 THEN
        RAISE EXCEPTION 'Choose a valid tenant account and room';
    END IF;
    IF p_move_in_date IS NULL OR p_move_in_date < CURRENT_DATE
       OR (p_move_out_date IS NOT NULL AND p_move_out_date <= p_move_in_date) THEN
        RAISE EXCEPTION 'Enter valid move-in and move-out dates';
    END IF;

    SELECT u.*
      INTO guest_row
      FROM public."users" AS u
     WHERE u."user_id" = p_user_id
       AND u."user_type" = 'Guest'
       AND u."is_active" = 1
       AND u."auth_user_id" IS NOT NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'An active Guest account is required to create a tenant';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM public."tenants" AS t
         WHERE t."user_id" = p_user_id
           AND t."is_active" = 1
    ) THEN
        RAISE EXCEPTION 'This account already has an active tenant record';
    END IF;

    PERFORM 1
      FROM public."rooms" AS r
     WHERE r."room_id" = p_room_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Select a valid room';
    END IF;

    SELECT availability."status", availability."available_beds"
      INTO room_status, available_beds
      FROM public.get_public_rooms_for_dates(
          p_move_in_date,
          COALESCE(p_move_out_date, '9999-12-31'::date)
      ) AS availability
     WHERE availability."room_id" = p_room_id;
    IF room_status IS NULL OR room_status = 'Maintenance' OR COALESCE(available_beds, 0) < 1 THEN
        RAISE EXCEPTION 'This room is full or unavailable for the selected dates';
    END IF;

    INSERT INTO public."tenants" (
        "user_id", "room_id", "full_name", "phone", "email",
        "move_in_date", "move_out_date", "is_active"
    ) VALUES (
        p_user_id, p_room_id, guest_row."full_name", guest_row."phone", guest_row."email",
        p_move_in_date, p_move_out_date, 1
    )
    RETURNING "tenant_id" INTO tenant_id_value;

    UPDATE public."users"
       SET "user_type" = 'Tenant'
     WHERE "user_id" = p_user_id
       AND "user_type" = 'Guest'
       AND "is_active" = 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The Guest account could not be promoted to a Tenant account';
    END IF;

    UPDATE public."rooms" AS target
       SET "status" = availability."status"
      FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS availability
     WHERE target."room_id" = p_room_id
       AND availability."room_id" = p_room_id;

    RETURN tenant_id_value;
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_tenant_from_guest(integer, integer, date, date)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_tenant_from_guest(integer, integer, date, date)
    TO authenticated;
