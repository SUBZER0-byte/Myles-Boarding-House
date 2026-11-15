CREATE OR REPLACE FUNCTION public.get_my_admin_settings_profile()
RETURNS TABLE (
    "user_id" integer,
    "full_name" varchar(150),
    "username" varchar(80),
    "email" varchar(150),
    "phone" varchar(40),
    "profile_picture" varchar(255)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT u."user_id", u."full_name", u."username", u."email", u."phone", u."profile_picture"
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."user_type" = 'Admin'
       AND u."is_active" = 1
     LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.update_my_admin_settings_profile(
    p_full_name text,
    p_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    app_user_id integer;
    normalized_phone text;
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

    UPDATE public."users"
       SET "full_name" = btrim(p_full_name),
           "phone" = NULLIF(normalized_phone, '')
     WHERE "user_id" = app_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_my_admin_email_available(p_email text)
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
           AND own_profile."user_type" = 'Admin'
           AND own_profile."is_active" = 1
    )
    AND NOT EXISTS (
        SELECT 1
          FROM public."users" AS other_profile
         WHERE lower(other_profile."email") = lower(btrim(p_email))
           AND other_profile."auth_user_id" IS DISTINCT FROM auth.uid()
    )
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_settings_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_admin_settings_profile(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_my_admin_email_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_settings_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_admin_settings_profile(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_admin_email_available(text) TO authenticated;
