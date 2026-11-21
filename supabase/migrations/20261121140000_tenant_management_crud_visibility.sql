CREATE OR REPLACE FUNCTION public.normalize_admin_tenant_archive_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW."is_active" = 1 AND NEW."deleted_at" IS NOT NULL THEN
    NEW."deleted_at" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_admin_tenant_archive_state ON public."tenants";
CREATE TRIGGER normalize_admin_tenant_archive_state
BEFORE INSERT OR UPDATE OF "is_active", "deleted_at" ON public."tenants"
FOR EACH ROW
EXECUTE FUNCTION public.normalize_admin_tenant_archive_state();

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
  WHERE t."deleted_at" IS NULL OR t."is_active" = 1;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_admin_tenants() TO authenticated;
