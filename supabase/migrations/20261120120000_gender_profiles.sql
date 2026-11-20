ALTER TABLE public."users"
    ADD COLUMN IF NOT EXISTS "gender" text;

ALTER TABLE public."users"
    DROP CONSTRAINT IF EXISTS "users_gender_check";

ALTER TABLE public."users"
    ADD CONSTRAINT "users_gender_check"
    CHECK (
        "gender" IS NULL
        OR "gender" IN ('Female', 'Male', 'Non-binary', 'Other', 'Prefer not to say')
    );

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    verified_phone varchar(40);
    profile_username varchar(80);
    profile_name varchar(150);
    profile_gender text;
    linked_admin_id integer;
    guest_claim public."auth_admin_guest_create_nonces"%ROWTYPE;
    guest_nonce text;
BEGIN
    IF NEW.raw_app_meta_data ->> 'mbh_admin_bootstrap' = 'true' THEN
        UPDATE public."users"
           SET "auth_user_id" = NEW.id
         WHERE "user_id" = 1
           AND "username" = 'admin'
           AND "user_type" = 'Admin'
           AND "auth_user_id" IS NULL
           AND lower("email") = lower(NEW.email)
        RETURNING "user_id" INTO linked_admin_id;

        IF linked_admin_id IS NULL THEN
            RAISE EXCEPTION 'No unlinked admin profile matches this Auth account';
        END IF;

        RETURN NEW;
    END IF;

    guest_nonce := NEW.raw_user_meta_data ->> 'mbh_admin_guest_create_nonce';
    IF guest_nonce IS NOT NULL AND guest_nonce <> '' THEN
        DELETE FROM public."auth_admin_guest_create_nonces"
         WHERE "nonce"::text = guest_nonce
           AND "email" = lower(NEW.email)
           AND "username" = NEW.raw_user_meta_data ->> 'username'
           AND "full_name" = NEW.raw_user_meta_data ->> 'full_name'
           AND COALESCE("phone", '') = COALESCE(NEW.raw_user_meta_data ->> 'phone', '')
           AND COALESCE("address", '') = COALESCE(NEW.raw_user_meta_data ->> 'address', '')
           AND COALESCE("birthday"::text, '') = COALESCE(NEW.raw_user_meta_data ->> 'birthday', '')
           AND COALESCE("age"::text, '') = COALESCE(NEW.raw_user_meta_data ->> 'age', '')
           AND COALESCE("emergency_contact_name", '') = COALESCE(NEW.raw_user_meta_data ->> 'emergency_contact_name', '')
           AND COALESCE("emergency_contact_phone", '') = COALESCE(NEW.raw_user_meta_data ->> 'emergency_contact_phone', '')
           AND "expires_at" > CURRENT_TIMESTAMP
        RETURNING * INTO guest_claim;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'The administrator guest creation claim is invalid or expired';
        END IF;

        INSERT INTO public."users" (
            "auth_user_id", "full_name", "username", "email", "phone", "address",
            "birthday", "age", "emergency_contact_name", "emergency_contact_phone",
            "gender", "user_type", "is_active"
        )
        VALUES (
            NEW.id, guest_claim."full_name", guest_claim."username", guest_claim."email",
            guest_claim."phone", guest_claim."address", guest_claim."birthday", guest_claim."age",
            guest_claim."emergency_contact_name", guest_claim."emergency_contact_phone",
            NULL, 'Guest', 1
        );

        RETURN NEW;
    END IF;

    verified_phone := regexp_replace(COALESCE(
        NULLIF(NEW.raw_user_meta_data ->> 'phone', ''),
        NEW.phone
    ), '[^0-9]', '', 'g');
    IF verified_phone ~ '^09[0-9]{9}$' THEN
        verified_phone := '+63' || substring(verified_phone FROM 2);
    ELSIF verified_phone ~ '^639[0-9]{9}$' THEN
        verified_phone := '+' || verified_phone;
    ELSIF verified_phone ~ '^9[0-9]{9}$' THEN
        verified_phone := '+63' || verified_phone;
    ELSE
        RAISE EXCEPTION 'A valid Philippine phone number is required';
    END IF;
    profile_username := NULLIF(NEW.raw_user_meta_data ->> 'username', '');
    profile_name := NULLIF(NEW.raw_user_meta_data ->> 'full_name', '');
    profile_gender := NULLIF(btrim(NEW.raw_user_meta_data ->> 'gender'), '');

    IF NEW.email IS NULL OR verified_phone IS NULL OR profile_username IS NULL OR profile_name IS NULL THEN
        RAISE EXCEPTION 'Required profile fields are missing';
    END IF;
    IF profile_gender IS NOT NULL
       AND profile_gender NOT IN ('Female', 'Male', 'Non-binary', 'Other', 'Prefer not to say') THEN
        RAISE EXCEPTION 'A valid gender is required';
    END IF;

    UPDATE public."auth_otp_challenges"
       SET "consumed_at" = CURRENT_TIMESTAMP
     WHERE "phone" = verified_phone
       AND "purpose" = 'signup'
       AND "email" = NEW.email
       AND "verified_at" IS NOT NULL
       AND "consumed_at" IS NULL
       AND "expires_at" > CURRENT_TIMESTAMP;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'A valid verified phone challenge is required';
    END IF;

    INSERT INTO public."users" (
        "auth_user_id", "full_name", "username", "email", "phone", "address",
        "birthday", "age", "emergency_contact_name", "emergency_contact_phone",
        "gender", "user_type"
    )
    VALUES (
        NEW.id, profile_name, profile_username, NEW.email, verified_phone,
        NULLIF(NEW.raw_user_meta_data ->> 'address', ''),
        NULLIF(NEW.raw_user_meta_data ->> 'birthday', '')::date,
        NULLIF(NEW.raw_user_meta_data ->> 'age', '')::smallint,
        NULLIF(NEW.raw_user_meta_data ->> 'emergency_contact_name', ''),
        NULLIF(NEW.raw_user_meta_data ->> 'emergency_contact_phone', ''),
        profile_gender, 'Guest'
    );

    RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.get_my_profile();
CREATE FUNCTION public.get_my_profile()
RETURNS TABLE (
    "user_id" integer,
    "username" varchar(80),
    "full_name" varchar(150),
    "email" varchar(150),
    "phone" varchar(40),
    "user_type" text,
    "gender" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT u."user_id", u."username", u."full_name", u."email", u."phone", u."user_type", u."gender"
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."is_active" = 1
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

DROP FUNCTION IF EXISTS public.get_my_settings_profile();
CREATE FUNCTION public.get_my_settings_profile()
RETURNS TABLE (
    "user_id" integer,
    "full_name" varchar(150),
    "username" varchar(80),
    "email" varchar(150),
    "phone" varchar(40),
    "address" varchar(255),
    "age" smallint,
    "birthday" date,
    "user_type" text,
    "tenant_id" integer,
    "move_in_date" date,
    "room_number" varchar(40),
    "profile_picture" varchar(255),
    "emergency_contact_name" varchar(150),
    "emergency_contact_phone" varchar(40),
    "gender" text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT
        u."user_id",
        u."full_name",
        u."username",
        u."email",
        u."phone",
        u."address",
        u."age",
        u."birthday",
        u."user_type",
        t."tenant_id",
        t."move_in_date",
        r."room_number",
        u."profile_picture",
        u."emergency_contact_name",
        u."emergency_contact_phone",
        u."gender"
    FROM public."users" AS u
    LEFT JOIN LATERAL (
        SELECT tenant."tenant_id", tenant."room_id", tenant."move_in_date"
        FROM public."tenants" AS tenant
        WHERE tenant."user_id" = u."user_id"
          AND tenant."is_active" = 1
        ORDER BY tenant."tenant_id" DESC
        LIMIT 1
    ) AS t ON true
    LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
    WHERE u."auth_user_id" = auth.uid()
      AND u."is_active" = 1
      AND u."user_type" IN ('Tenant', 'Guest');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active Tenant or Guest profile not found';
    END IF;
END;
$$;

CREATE FUNCTION public.update_my_settings_profile(
    p_full_name text,
    p_phone text,
    p_address text,
    p_age integer,
    p_birthday date,
    p_emergency_contact_name text,
    p_emergency_contact_phone text,
    p_gender text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    app_user_id integer;
    app_user_type text;
    emergency_phone text;
    gender_value text;
BEGIN
    SELECT u."user_id", u."user_type"
      INTO app_user_id, app_user_type
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."is_active" = 1
     FOR UPDATE;

    IF app_user_id IS NULL OR app_user_type NOT IN ('Tenant', 'Guest') THEN
        RAISE EXCEPTION 'Active Tenant or Guest profile not found';
    END IF;

    IF NULLIF(btrim(p_full_name), '') IS NULL OR length(btrim(p_full_name)) > 150 THEN
        RAISE EXCEPTION 'Enter a valid name';
    END IF;
    IF length(btrim(COALESCE(p_phone, ''))) > 40 THEN
        RAISE EXCEPTION 'Phone number must be 40 characters or fewer';
    END IF;
    IF length(btrim(COALESCE(p_address, ''))) > 255 THEN
        RAISE EXCEPTION 'Address must be 255 characters or fewer';
    END IF;
    IF p_age IS NOT NULL AND (p_age < 0 OR p_age > 120) THEN
        RAISE EXCEPTION 'Age must be a number from 0 to 120';
    END IF;
    IF p_birthday IS NOT NULL AND p_birthday > CURRENT_DATE THEN
        RAISE EXCEPTION 'Enter a valid birthday that is not in the future';
    END IF;
    IF length(btrim(COALESCE(p_emergency_contact_name, ''))) > 150 THEN
        RAISE EXCEPTION 'Emergency contact name must be 150 characters or fewer';
    END IF;

    emergency_phone := regexp_replace(COALESCE(p_emergency_contact_phone, ''), '[^0-9]', '', 'g');
    IF left(emergency_phone, 2) = '63' THEN
        emergency_phone := '0' || substring(emergency_phone FROM 3);
    ELSIF length(emergency_phone) = 10 AND left(emergency_phone, 1) = '9' THEN
        emergency_phone := '0' || emergency_phone;
    END IF;
    IF emergency_phone <> '' AND emergency_phone !~ '^09[0-9]{9}$' THEN
        RAISE EXCEPTION 'Enter a valid Philippines emergency contact phone number';
    END IF;

    gender_value := NULLIF(btrim(COALESCE(p_gender, '')), '');
    IF gender_value IS NOT NULL
       AND gender_value NOT IN ('Female', 'Male', 'Non-binary', 'Other', 'Prefer not to say') THEN
        RAISE EXCEPTION 'Choose a valid gender';
    END IF;

    UPDATE public."users"
       SET "full_name" = btrim(p_full_name),
           "phone" = NULLIF(btrim(COALESCE(p_phone, '')), ''),
           "address" = NULLIF(btrim(COALESCE(p_address, '')), ''),
           "age" = p_age,
           "birthday" = p_birthday,
           "emergency_contact_name" = NULLIF(btrim(COALESCE(p_emergency_contact_name, '')), ''),
           "emergency_contact_phone" = NULLIF(emergency_phone, ''),
           "gender" = gender_value
     WHERE "user_id" = app_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_settings_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_settings_profile(text, text, text, integer, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_settings_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_settings_profile(text, text, text, integer, date, text, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.get_my_admin_settings_profile();
CREATE FUNCTION public.get_my_admin_settings_profile()
RETURNS TABLE (
    "user_id" integer,
    "full_name" varchar(150),
    "username" varchar(80),
    "email" varchar(150),
    "phone" varchar(40),
    "profile_picture" varchar(255),
    "gender" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT u."user_id", u."full_name", u."username", u."email", u."phone", u."profile_picture", u."gender"
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."user_type" = 'Admin'
       AND u."is_active" = 1
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_settings_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_settings_profile() TO authenticated;

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
                'room_type', r."room_type",
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

REVOKE ALL ON FUNCTION public.list_admin_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_admin_tenants() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_admin_guest_booking_genders()
RETURNS TABLE ("booking_id" integer, "gender" text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    RETURN QUERY
    SELECT b."booking_id", u."gender"
      FROM public."bookings" AS b
      LEFT JOIN public."users" AS u ON u."user_id" = b."guest_user_id";
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_guest_booking_genders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_admin_guest_booking_genders() TO authenticated;
