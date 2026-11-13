CREATE OR REPLACE FUNCTION public.manage_my_admin_tenants(
    p_action text,
    p_auth_user_id uuid,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    app_user_id integer;
    tenant_row public."tenants"%ROWTYPE;
    user_id_value integer;
    room_id_value integer;
    tenant_id_value integer;
    old_room_id integer;
    move_in_value date;
    move_out_value date;
    email_value text;
    phone_value text;
    username_value text;
    full_name_value text;
    address_value text;
    birthday_value date;
    emergency_name_value text;
    emergency_phone_value text;
    age_value smallint;
    own_beds bigint;
    available_beds bigint;
    room_status text;
    result jsonb;
BEGIN
    SELECT u."user_id"
      INTO app_user_id
      FROM public."users" AS u
     WHERE u."auth_user_id" = p_auth_user_id
       AND u."user_type" = 'Admin'
       AND u."is_active" = 1;
    IF app_user_id IS NULL THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    IF p_action = 'list' THEN
        SELECT COALESCE(jsonb_agg(row_data ORDER BY full_name), '[]'::jsonb)
          INTO result
          FROM (
              SELECT t."full_name",
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
                         'emergency_contact_name', u."emergency_contact_name",
                         'emergency_contact_phone', u."emergency_contact_phone",
                         'move_in_date', t."move_in_date",
                         'move_out_date', t."move_out_date",
                         'is_active', t."is_active",
                         'room_number', r."room_number",
                         'room_type', r."room_type",
                         'profile_picture', u."profile_picture"
                     ) AS row_data
                FROM public."tenants" AS t
                LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
                LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
          ) AS tenant_list;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF p_action = 'suggestions' THEN
        username_value := btrim(COALESCE(p_data->>'query', ''));
        IF length(username_value) < 2 THEN
            RETURN jsonb_build_object('type', 'success', 'data', '[]'::jsonb);
        END IF;
        SELECT COALESCE(jsonb_agg(row_data ORDER BY username), '[]'::jsonb)
          INTO result
          FROM (
              SELECT u."username",
                     jsonb_build_object(
                         'user_id', u."user_id",
                         'username', u."username",
                         'full_name', u."full_name",
                         'email', u."email",
                         'phone', u."phone",
                         'address', u."address",
                         'birthday', u."birthday",
                         'emergency_contact_name', u."emergency_contact_name",
                         'emergency_contact_phone', u."emergency_contact_phone",
                         'user_type', u."user_type"
                     ) AS row_data
                FROM public."users" AS u
               WHERE u."username" ILIKE '%' || username_value || '%'
                 AND u."user_type" = 'Tenant'
                 AND u."is_active" = 1
                 AND NOT EXISTS (
                     SELECT 1 FROM public."tenants" AS t
                      WHERE t."user_id" = u."user_id" AND t."is_active" = 1
                 )
               ORDER BY u."username"
               LIMIT 8
          ) AS available_accounts;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF p_action NOT IN ('create', 'update', 'deactivate', 'delete') THEN
        RAISE EXCEPTION 'Invalid tenant management action';
    END IF;

    IF p_action IN ('deactivate', 'delete', 'update') THEN
        IF jsonb_typeof(p_data->'tenant_id') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'A valid tenant ID is required';
        END IF;
        tenant_id_value := (p_data->>'tenant_id')::integer;
        SELECT t.*
          INTO tenant_row
          FROM public."tenants" AS t
         WHERE t."tenant_id" = tenant_id_value
         FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Tenant record not found';
        END IF;
    END IF;

    SELECT t."room_id" INTO old_room_id
      FROM public."tenants" AS t
     WHERE t."tenant_id" = tenant_id_value;

    IF p_action = 'deactivate' THEN
        UPDATE public."tenants" SET "is_active" = 0 WHERE "tenant_id" = tenant_id_value;
        IF tenant_row."user_id" IS NOT NULL THEN
            UPDATE public."users" SET "user_type" = 'Guest'
             WHERE "user_id" = tenant_row."user_id" AND "user_type" = 'Tenant';
        END IF;
        IF old_room_id IS NOT NULL THEN
            UPDATE public."rooms" AS target
               SET "status" = availability."status"
              FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS availability
             WHERE target."room_id" = old_room_id
               AND availability."room_id" = old_room_id;
        END IF;
        RETURN jsonb_build_object('type', 'success', 'message', 'Deactivated');
    END IF;

    IF p_action = 'delete' THEN
        IF EXISTS (SELECT 1 FROM public."payments" WHERE "tenant_id" = tenant_id_value)
           OR EXISTS (SELECT 1 FROM public."complaints" WHERE "tenant_id" = tenant_id_value)
           OR EXISTS (SELECT 1 FROM public."maintenance_requests" WHERE "tenant_id" = tenant_id_value)
           OR EXISTS (SELECT 1 FROM public."ratings" WHERE "tenant_id" = tenant_id_value)
           OR EXISTS (SELECT 1 FROM public."cancellation_requests" WHERE "tenant_id" = tenant_id_value)
           OR EXISTS (SELECT 1 FROM public."room_change_requests" WHERE "tenant_id" = tenant_id_value)
           OR EXISTS (SELECT 1 FROM public."full_payment_requests" WHERE "tenant_id" = tenant_id_value) THEN
            RAISE EXCEPTION 'Tenant cannot be deleted while payment, request, or cancellation records reference the account; deactivate the tenant instead';
        END IF;
        DELETE FROM public."tenants" WHERE "tenant_id" = tenant_id_value;
        IF tenant_row."user_id" IS NOT NULL THEN
            UPDATE public."users" SET "user_type" = 'Guest'
             WHERE "user_id" = tenant_row."user_id" AND "user_type" = 'Tenant';
        END IF;
        IF old_room_id IS NOT NULL THEN
            UPDATE public."rooms" AS target
               SET "status" = availability."status"
              FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS availability
             WHERE target."room_id" = old_room_id
               AND availability."room_id" = old_room_id;
        END IF;
        RETURN jsonb_build_object('type', 'success', 'message', 'Deleted');
    END IF;

    full_name_value := btrim(COALESCE(p_data->>'full_name', ''));
    email_value := lower(btrim(COALESCE(p_data->>'email', '')));
    phone_value := regexp_replace(COALESCE(p_data->>'phone', ''), '[^0-9]', '', 'g');
    IF left(phone_value, 2) = '63' THEN
        phone_value := '0' || substring(phone_value FROM 3);
    ELSIF length(phone_value) = 10 AND left(phone_value, 1) = '9' THEN
        phone_value := '0' || phone_value;
    END IF;
    address_value := btrim(COALESCE(p_data->>'address', ''));
    emergency_name_value := btrim(COALESCE(p_data->>'emergency_contact_name', ''));
    emergency_phone_value := regexp_replace(COALESCE(p_data->>'emergency_contact_phone', ''), '[^0-9]', '', 'g');
    IF left(emergency_phone_value, 2) = '63' THEN
        emergency_phone_value := '0' || substring(emergency_phone_value FROM 3);
    ELSIF length(emergency_phone_value) = 10 AND left(emergency_phone_value, 1) = '9' THEN
        emergency_phone_value := '0' || emergency_phone_value;
    END IF;
    username_value := btrim(COALESCE(p_data->>'username', ''));
    move_in_value := NULLIF(p_data->>'move_in_date', '')::date;
    move_out_value := NULLIF(p_data->>'move_out_date', '')::date;
    room_id_value := NULLIF(p_data->>'room_id', '')::integer;
    birthday_value := NULLIF(p_data->>'birthday', '')::date;

    IF full_name_value !~ '^[[:alpha:] .''-]{2,150}$' OR length(email_value) > 150
       OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       OR phone_value !~ '^09[0-9]{9}$' THEN
        RAISE EXCEPTION 'Enter a valid tenant name, email, and Philippine phone number';
    END IF;
    IF length(address_value) > 255 OR length(emergency_name_value) > 150
       OR (emergency_phone_value <> '' AND emergency_phone_value !~ '^09[0-9]{9}$') THEN
        RAISE EXCEPTION 'Enter valid address and emergency contact details';
    END IF;
    IF move_in_value IS NULL OR (move_out_value IS NOT NULL AND move_out_value <= move_in_value) THEN
        RAISE EXCEPTION 'Move-out date must be after the move-in date';
    END IF;
    IF birthday_value IS NOT NULL AND (birthday_value > CURRENT_DATE OR birthday_value < CURRENT_DATE - interval '120 years') THEN
        RAISE EXCEPTION 'Enter a valid birthday that is not in the future';
    END IF;
    age_value := CASE WHEN birthday_value IS NULL THEN NULL
                      ELSE date_part('year', age(CURRENT_DATE, birthday_value))::smallint END;

    IF p_action = 'create' THEN
        user_id_value := NULL;
        IF username_value <> '' THEN
            SELECT u."user_id" INTO user_id_value
              FROM public."users" AS u
             WHERE u."username" = username_value
               AND u."user_type" = 'Tenant'
               AND u."is_active" = 1
               AND NOT EXISTS (
                   SELECT 1 FROM public."tenants" AS t
                    WHERE t."user_id" = u."user_id" AND t."is_active" = 1
               )
             LIMIT 1
             FOR UPDATE;
            IF user_id_value IS NULL THEN
                RAISE EXCEPTION 'No eligible Tenant account was found with that username';
            END IF;
        END IF;
        IF user_id_value IS NULL AND (address_value <> '' OR birthday_value IS NOT NULL
           OR emergency_name_value <> '' OR emergency_phone_value <> '') THEN
            RAISE EXCEPTION 'Link an eligible Tenant login to save address, birthday, or emergency contact details';
        END IF;
    ELSE
        user_id_value := tenant_row."user_id";
        IF user_id_value IS NULL AND username_value <> '' THEN
            SELECT u."user_id" INTO user_id_value
              FROM public."users" AS u
             WHERE u."username" = username_value
               AND u."user_type" = 'Tenant'
               AND u."is_active" = 1
               AND NOT EXISTS (
                   SELECT 1 FROM public."tenants" AS t
                    WHERE t."user_id" = u."user_id" AND t."is_active" = 1
               )
             LIMIT 1
             FOR UPDATE;
            IF user_id_value IS NULL THEN
                RAISE EXCEPTION 'No eligible Tenant account was found with that username';
            END IF;
        END IF;
        IF user_id_value IS NULL AND (address_value <> '' OR birthday_value IS NOT NULL
           OR emergency_name_value <> '' OR emergency_phone_value <> '') THEN
            RAISE EXCEPTION 'Link an eligible Tenant login to save address, birthday, or emergency contact details';
        END IF;
    END IF;

    IF user_id_value IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public."users" AS u
             WHERE u."user_id" <> user_id_value
               AND (lower(u."email") = email_value
                    OR regexp_replace(u."phone", '[^0-9]', '', 'g') IN (phone_value, '63' || substring(phone_value FROM 2)))
        ) THEN
            RAISE EXCEPTION 'Tenant account email or phone is already used by another account';
        END IF;
        UPDATE public."users"
           SET "full_name" = full_name_value,
               "email" = email_value,
               "phone" = phone_value,
               "address" = NULLIF(address_value, ''),
               "age" = age_value,
               "birthday" = birthday_value,
               "emergency_contact_name" = NULLIF(emergency_name_value, ''),
               "emergency_contact_phone" = NULLIF(emergency_phone_value, '')
         WHERE "user_id" = user_id_value AND "user_type" <> 'Admin' AND "is_active" = 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Eligible Tenant account not found';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public."tenants" AS t
         WHERE t."is_active" = 1
           AND t."tenant_id" IS DISTINCT FROM tenant_id_value
           AND t."phone" = phone_value
    ) OR EXISTS (
        SELECT 1
          FROM public."bookings" AS b
         WHERE regexp_replace(COALESCE(b."phone", ''), '[^0-9]', '', 'g') IN (phone_value, '63' || substring(phone_value FROM 2))
           AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND (
               b."status" <> 'Pending'
               OR b."payment_expires_at" > CURRENT_TIMESTAMP
               OR EXISTS (
                   SELECT 1 FROM public."booking_initial_payment_requests" AS ip
                    WHERE ip."booking_id" = b."booking_id" AND ip."status" IN ('Submitted', 'Confirmed')
               )
               OR EXISTS (
                   SELECT 1 FROM public."payments" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."payment_type" = CASE
                          WHEN b."payment_plan" = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                          ELSE 'Security Deposit'
                      END
                      AND ip."status" IN ('Submitted', 'Confirmed', 'Paid')
               )
           )
    ) THEN
        RAISE EXCEPTION 'This phone number is already associated with an active booking or tenant';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public."users" AS u
         WHERE u."user_id" IS DISTINCT FROM user_id_value
           AND lower(u."email") = email_value
    ) THEN
        RAISE EXCEPTION 'Email is already used by another account';
    END IF;

    IF room_id_value IS NOT NULL AND (
        move_out_value IS NULL OR move_out_value > CURRENT_DATE
    ) THEN
        IF NOT EXISTS (SELECT 1 FROM public."rooms" WHERE "room_id" = room_id_value) THEN
            RAISE EXCEPTION 'Select a valid room';
        END IF;
        PERFORM 1 FROM public."rooms" WHERE "room_id" = room_id_value FOR UPDATE;
        SELECT a."status", a."available_beds"
          INTO room_status, available_beds
          FROM public.get_public_rooms_for_dates(
              GREATEST(move_in_value, CURRENT_DATE),
              GREATEST(COALESCE(move_out_value, '9999-12-31'::date), GREATEST(move_in_value, CURRENT_DATE) + 1)
          ) AS a
         WHERE a."room_id" = room_id_value;
        IF room_status IS NULL OR room_status = 'Maintenance' THEN
            RAISE EXCEPTION 'This room is unavailable';
        END IF;

        own_beds := 0;
        IF p_action = 'update' THEN
            SELECT COALESCE(SUM(
                       CASE WHEN t."reservation_type" = 'entire_room' THEN r."capacity"
                            ELSE LEAST(GREATEST(t."occupant_count", 1), r."capacity") END
                   ), 0)
              INTO own_beds
              FROM public."tenants" AS t
              JOIN public."rooms" AS r ON r."room_id" = t."room_id"
             WHERE t."tenant_id" = tenant_id_value
               AND t."is_active" = 1
               AND t."room_id" = room_id_value
               AND t."move_in_date" < COALESCE(move_out_value, '9999-12-31'::date)
               AND COALESCE(t."move_out_date", '9999-12-31'::date) > GREATEST(move_in_value, CURRENT_DATE);
        END IF;
        IF COALESCE(available_beds, 0) + own_beds < 1 THEN
            RAISE EXCEPTION 'This room is full or already reserved for those dates';
        END IF;
    END IF;

    IF p_action = 'create' THEN
        INSERT INTO public."tenants" (
            "user_id", "room_id", "full_name", "phone", "email",
            "move_in_date", "move_out_date", "is_active"
        ) VALUES (
            user_id_value, room_id_value, full_name_value, phone_value, email_value,
            move_in_value, move_out_value, 1
        )
        RETURNING "tenant_id" INTO tenant_id_value;
        IF room_id_value IS NOT NULL THEN
            UPDATE public."rooms" AS target
               SET "status" = availability."status"
              FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS availability
             WHERE target."room_id" = room_id_value
               AND availability."room_id" = room_id_value;
        END IF;
        RETURN jsonb_build_object(
            'type', 'success',
            'message', 'Tenant created',
            'tenant_id', tenant_id_value,
            'user_id', user_id_value
        );
    END IF;

    UPDATE public."tenants"
       SET "user_id" = user_id_value,
           "full_name" = full_name_value,
           "phone" = phone_value,
           "email" = email_value,
           "room_id" = room_id_value,
           "move_in_date" = move_in_value,
           "move_out_date" = move_out_value
     WHERE "tenant_id" = tenant_id_value;
    IF old_room_id IS NOT NULL AND old_room_id IS DISTINCT FROM room_id_value THEN
        UPDATE public."rooms" AS target
           SET "status" = availability."status"
          FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS availability
         WHERE target."room_id" = old_room_id
           AND availability."room_id" = old_room_id;
    END IF;
    IF room_id_value IS NOT NULL THEN
        UPDATE public."rooms" AS target
           SET "status" = availability."status"
          FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS availability
         WHERE target."room_id" = room_id_value
           AND availability."room_id" = room_id_value;
    END IF;
    RETURN jsonb_build_object('type', 'success', 'message', 'Updated', 'user_id', user_id_value);
END;
$$;

REVOKE ALL ON FUNCTION public.manage_my_admin_tenants(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_my_admin_tenants(text, uuid, jsonb) TO service_role;
