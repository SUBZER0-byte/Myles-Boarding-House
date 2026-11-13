CREATE OR REPLACE FUNCTION public.get_tenant_dashboard_snapshot(p_auth_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
    WITH tenant AS (
        SELECT t."tenant_id", t."full_name", t."room_id"
        FROM public."tenants" AS t
        INNER JOIN public."users" AS u ON u."user_id" = t."user_id"
        WHERE u."auth_user_id" = p_auth_user_id
          AND u."user_type" = 'Tenant'
          AND u."is_active" = 1
          AND t."is_active" = 1
        LIMIT 1
    )
    SELECT jsonb_build_object(
        'tenant_name', t."full_name",
        'room_info', (
            SELECT jsonb_build_object(
                'room_id', r."room_id",
                'room_number', r."room_number",
                'room_type', r."room_type",
                'monthly_rent', r."monthly_rent",
                'status', r."status"
            )
            FROM public."rooms" AS r
            WHERE r."room_id" = t."room_id"
        ),
        'current_balance', (
            SELECT COALESCE(sum(p."amount"), 0)
            FROM public."payments" AS p
            WHERE p."tenant_id" = t."tenant_id"
              AND p."status" IN ('Pending', 'Overdue')
        ),
        'next_due_payment', (
            SELECT jsonb_build_object(
                'payment_id', p."payment_id",
                'amount', p."amount",
                'due_date', p."due_date",
                'status', p."status"
            )
            FROM public."payments" AS p
            WHERE p."tenant_id" = t."tenant_id"
              AND p."status" IN ('Pending', 'Overdue')
            ORDER BY p."due_date" ASC
            LIMIT 1
        ),
        'last_payment', (
            SELECT jsonb_build_object(
                'payment_id', p."payment_id",
                'amount', p."amount",
                'paid_at', p."paid_at",
                'method', p."method"
            )
            FROM public."payments" AS p
            WHERE p."tenant_id" = t."tenant_id"
              AND p."status" = 'Paid'
            ORDER BY p."paid_at" DESC NULLS LAST
            LIMIT 1
        ),
        'announcements', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'announcement_id', recent."announcement_id",
                        'title', recent."title",
                        'body', recent."body",
                        'created_at', recent."created_at"
                    )
                    ORDER BY recent."created_at" DESC
                ),
                '[]'::jsonb
            )
            FROM (
                SELECT a."announcement_id", a."title", a."body", a."created_at"
                FROM public."announcements" AS a
                WHERE a."is_published" = 1
                ORDER BY a."created_at" DESC
                LIMIT 5
            ) AS recent
        ),
        'maintenance', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'request_id', recent."request_id",
                        'title', recent."title",
                        'status', recent."status",
                        'created_at', recent."created_at"
                    )
                    ORDER BY recent."created_at" DESC
                ),
                '[]'::jsonb
            )
            FROM (
                SELECT m."request_id", m."title", m."status", m."created_at"
                FROM public."maintenance_requests" AS m
                WHERE m."tenant_id" = t."tenant_id"
                ORDER BY m."created_at" DESC
                LIMIT 5
            ) AS recent
        ),
        'complaints', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'complaint_id', recent."complaint_id",
                        'title', recent."title",
                        'status', recent."status",
                        'created_at', recent."created_at"
                    )
                    ORDER BY recent."created_at" DESC
                ),
                '[]'::jsonb
            )
            FROM (
                SELECT c."complaint_id", c."title", c."status", c."created_at"
                FROM public."complaints" AS c
                WHERE c."tenant_id" = t."tenant_id"
                ORDER BY c."created_at" DESC
                LIMIT 5
            ) AS recent
        ),
        'maintenance_summary', (
            SELECT COALESCE(jsonb_object_agg(summary."status", summary."count"), '{}'::jsonb)
            FROM (
                SELECT m."status", count(*) AS "count"
                FROM public."maintenance_requests" AS m
                WHERE m."tenant_id" = t."tenant_id"
                GROUP BY m."status"
            ) AS summary
        ),
        'complaint_summary', (
            SELECT COALESCE(jsonb_object_agg(summary."status", summary."count"), '{}'::jsonb)
            FROM (
                SELECT c."status", count(*) AS "count"
                FROM public."complaints" AS c
                WHERE c."tenant_id" = t."tenant_id"
                GROUP BY c."status"
            ) AS summary
        )
    )
    FROM tenant AS t;
$function$;

REVOKE ALL ON FUNCTION public.get_tenant_dashboard_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_dashboard_snapshot(uuid) TO service_role;
