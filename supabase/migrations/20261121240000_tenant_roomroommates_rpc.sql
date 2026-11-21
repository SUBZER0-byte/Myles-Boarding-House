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
          AND t."deleted_at" IS NULL
        ORDER BY t."tenant_id" DESC
        LIMIT 1
    ),
    booking AS (
        SELECT b."booking_id", b."check_out_date"
        FROM current_tenant AS t
        LEFT JOIN LATERAL (
            SELECT active_booking."booking_id", active_booking."check_out_date"
            FROM public."bookings" AS active_booking
            WHERE active_booking."room_id" = t."room_id"
              AND active_booking."status" IN ('Confirmed', 'Checked In', 'Active')
              AND (
                  lower(btrim(active_booking."email")) = lower(btrim(t."user_email"))
                  OR lower(btrim(active_booking."email")) = lower(btrim(t."tenant_email"))
              )
            ORDER BY active_booking."created_at" DESC, active_booking."booking_id" DESC
            LIMIT 1
        ) AS b ON true
    ),
    roommates AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'tenant_id', roommate."tenant_id",
                    'full_name', roommate."full_name",
                    'gender', COALESCE(roommate_user."gender", 'Not provided'),
                    'move_in_date', roommate."move_in_date",
                    'move_out_date', roommate."move_out_date"
                )
                ORDER BY roommate."full_name"
            ),
            '[]'::jsonb
        ) AS data
        FROM current_tenant AS current_row
        JOIN public."tenants" AS roommate
          ON roommate."room_id" = current_row."room_id"
         AND roommate."tenant_id" <> current_row."tenant_id"
         AND roommate."is_active" = 1
         AND roommate."deleted_at" IS NULL
         AND COALESCE(roommate."move_out_date", '9999-12-31'::date) > CURRENT_DATE
        LEFT JOIN public."users" AS roommate_user
          ON roommate_user."user_id" = roommate."user_id"
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
        'roommates', COALESCE(roommates.data, '[]'::jsonb),
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
    JOIN public."rooms" AS r ON r."room_id" = t."room_id"
    LEFT JOIN booking ON true
    LEFT JOIN roommates ON true;
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant_room() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_room() TO authenticated;
