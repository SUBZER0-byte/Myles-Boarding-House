CREATE OR REPLACE FUNCTION public.sync_my_admin_profile_email(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  app_user_id integer;
  normalized_email text;
BEGIN
  normalized_email := lower(btrim(COALESCE(p_email, '')));
  IF normalized_email = '' OR length(normalized_email) > 150
     OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;

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

  IF EXISTS (
    SELECT 1
      FROM public."users" AS u
     WHERE lower(u."email") = normalized_email
       AND u."auth_user_id" IS DISTINCT FROM auth.uid()
  ) THEN
    RAISE EXCEPTION 'That email address is already in use';
  END IF;

  UPDATE public."users"
     SET "email" = normalized_email
   WHERE "user_id" = app_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_my_admin_profile_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_my_admin_profile_email(text) TO authenticated;
