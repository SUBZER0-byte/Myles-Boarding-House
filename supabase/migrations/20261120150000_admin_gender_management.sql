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
    SELECT u."user_id", u."full_name", u."username", u."email", u."phone",
           u."profile_picture", u."gender"
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."user_type" = 'Admin'
       AND u."is_active" = 1
     LIMIT 1
$$;

DROP FUNCTION IF EXISTS public.update_my_admin_settings_profile(text, text);
CREATE FUNCTION public.update_my_admin_settings_profile(
    p_full_name text,
    p_phone text,
    p_gender text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    app_user_id integer;
    normalized_phone text;
    gender_value text;
BEGIN
    SELECT u."user_id"
      INTO app_user_id
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."user_type" = 'Admin'
       AND u."is_active" = 1
     FOR UPDATE;
    IF app_user_id IS NULL THEN
        RAISE EXCEPTION 'Active administrator profile not found';
    END IF;
    IF NULLIF(btrim(p_full_name), '') IS NULL OR length(btrim(p_full_name)) > 150 THEN
        RAISE EXCEPTION 'Enter a valid name';
    END IF;
    normalized_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    IF length(normalized_phone) > 40 THEN
        RAISE EXCEPTION 'Phone number must be 40 characters or fewer';
    END IF;

    gender_value := NULLIF(btrim(COALESCE(p_gender, '')), '');
    IF gender_value IS NOT NULL AND gender_value NOT IN ('Male', 'Female') THEN
        RAISE EXCEPTION 'Choose Male or Female for gender';
    END IF;

    UPDATE public."users"
       SET "full_name" = btrim(p_full_name),
           "phone" = NULLIF(normalized_phone, ''),
           "gender" = gender_value
     WHERE "user_id" = app_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_settings_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_admin_settings_profile(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_settings_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_admin_settings_profile(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_tenant_account_gender(p_user_id integer)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    gender_value text;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    SELECT u."gender"
      INTO gender_value
      FROM public."users" AS u
     WHERE u."user_id" = p_user_id
       AND u."user_type" = 'Tenant'
       AND u."is_active" = 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active Tenant account not found';
    END IF;
    RETURN gender_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_admin_tenant_gender(
    p_tenant_id integer,
    p_gender text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    tenant_user_id integer;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_gender IS NOT NULL AND p_gender NOT IN ('Male', 'Female') THEN
        RAISE EXCEPTION 'Choose Male or Female for gender';
    END IF;

    SELECT t."user_id"
      INTO tenant_user_id
      FROM public."tenants" AS t
     WHERE t."tenant_id" = p_tenant_id
       AND t."deleted_at" IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tenant record not found';
    END IF;
    IF tenant_user_id IS NULL THEN
        IF p_gender IS NOT NULL THEN
            RAISE EXCEPTION 'Link a Tenant account before saving gender';
        END IF;
        RETURN;
    END IF;

    UPDATE public."users"
       SET "gender" = p_gender
     WHERE "user_id" = tenant_user_id
       AND "user_type" IN ('Tenant', 'Guest');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Linked Tenant account not found';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_tenant_account_gender(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_admin_tenant_gender(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_tenant_account_gender(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_tenant_gender(integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
