CREATE OR REPLACE FUNCTION public.get_my_settings_profile()
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
    "emergency_contact_phone" varchar(40)
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
        u."emergency_contact_phone"
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

CREATE OR REPLACE FUNCTION public.update_my_settings_profile(
    p_full_name text,
    p_phone text,
    p_address text,
    p_age integer,
    p_birthday date,
    p_emergency_contact_name text,
    p_emergency_contact_phone text
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

    UPDATE public."users"
       SET "full_name" = btrim(p_full_name),
           "phone" = NULLIF(btrim(COALESCE(p_phone, '')), ''),
           "address" = NULLIF(btrim(COALESCE(p_address, '')), ''),
           "age" = p_age,
           "birthday" = p_birthday,
           "emergency_contact_name" = NULLIF(btrim(COALESCE(p_emergency_contact_name, '')), ''),
           "emergency_contact_phone" = NULLIF(emergency_phone, '')
     WHERE "user_id" = app_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_my_profile_email_available(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public."users" AS own_profile
        WHERE own_profile."auth_user_id" = auth.uid()
          AND own_profile."is_active" = 1
          AND own_profile."user_type" IN ('Tenant', 'Guest')
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public."users" AS other_profile
        WHERE lower(other_profile."email") = lower(btrim(p_email))
          AND other_profile."auth_user_id" IS DISTINCT FROM auth.uid()
    )
$$;

CREATE OR REPLACE FUNCTION public.sync_auth_user_email_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.email IS DISTINCT FROM OLD.email THEN
        UPDATE public."users"
           SET "email" = NEW.email
         WHERE "auth_user_id" = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_settings_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_settings_profile(text, text, text, integer, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_my_profile_email_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_settings_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_settings_profile(text, text, text, integer, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_profile_email_available(text) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_auth_user_email_to_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS "on_auth_user_email_updated_profile" ON auth.users;
CREATE TRIGGER "on_auth_user_email_updated_profile"
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_auth_user_email_to_profile();
