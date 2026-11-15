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
        ORDER BY t."tenant_id" DESC
        LIMIT 1
    )
    SELECT jsonb_build_object(
        'room_id', r."room_id",
        'room_number', r."room_number",
        'room_type', r."room_type",
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
    INNER JOIN public."rooms" AS r ON r."room_id" = t."room_id"
    LEFT JOIN LATERAL (
        SELECT b."booking_id", b."check_out_date"
        FROM public."bookings" AS b
        WHERE b."room_id" = t."room_id"
          AND b."status" IN ('Confirmed', 'Checked In', 'Active')
          AND (
              (NULLIF(btrim(t."user_email"), '') IS NOT NULL
               AND lower(btrim(b."email")) = lower(btrim(t."user_email")))
              OR (NULLIF(btrim(t."tenant_email"), '') IS NOT NULL
                  AND lower(btrim(b."email")) = lower(btrim(t."tenant_email")))
          )
        ORDER BY b."created_at" DESC, b."booking_id" DESC
        LIMIT 1
    ) AS booking ON true;
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant_room() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_room() TO authenticated;
