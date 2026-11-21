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
                     'status', r."status",
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
      ) AS rooms;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_rooms() TO authenticated;
