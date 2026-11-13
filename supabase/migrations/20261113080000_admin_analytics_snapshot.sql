CREATE OR REPLACE FUNCTION public.get_admin_analytics_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
    SELECT jsonb_build_object(
        'revenue', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object('month', recent."month", 'total', recent."total")
                    ORDER BY recent."month" ASC
                ),
                '[]'::jsonb
            )
            FROM (
                SELECT
                    to_char(date_trunc('month', p."paid_at"), 'YYYY-MM') AS "month",
                    COALESCE(sum(p."amount"), 0) AS "total"
                FROM public."payments" AS p
                WHERE p."status" = 'Paid'
                  AND p."paid_at" IS NOT NULL
                GROUP BY date_trunc('month', p."paid_at")
                ORDER BY date_trunc('month', p."paid_at") DESC
                LIMIT 12
            ) AS recent
        ),
        'bookings', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object('month', recent."month", 'total', recent."total")
                    ORDER BY recent."month" ASC
                ),
                '[]'::jsonb
            )
            FROM (
                SELECT
                    to_char(date_trunc('month', b."created_at"), 'YYYY-MM') AS "month",
                    count(*) AS "total"
                FROM public."bookings" AS b
                WHERE b."created_at" IS NOT NULL
                  AND b."status" <> 'Cancelled'
                GROUP BY date_trunc('month', b."created_at")
                ORDER BY date_trunc('month', b."created_at") DESC
                LIMIT 12
            ) AS recent
        ),
        'occupancy', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object('month', recent."month", 'new_tenants', recent."new_tenants")
                    ORDER BY recent."month" ASC
                ),
                '[]'::jsonb
            )
            FROM (
                SELECT
                    to_char(date_trunc('month', t."move_in_date"), 'YYYY-MM') AS "month",
                    count(*) AS "new_tenants"
                FROM public."tenants" AS t
                WHERE t."move_in_date" IS NOT NULL
                GROUP BY date_trunc('month', t."move_in_date")
                ORDER BY date_trunc('month', t."move_in_date") DESC
                LIMIT 12
            ) AS recent
        ),
        'complaints', (
            SELECT COALESCE(
                jsonb_agg(jsonb_build_object('status', c."status", 'cnt', c."count")),
                '[]'::jsonb
            )
            FROM (
                SELECT c."status", count(*) AS "count"
                FROM public."complaints" AS c
                GROUP BY c."status"
            ) AS c
        ),
        'maintenance', (
            SELECT COALESCE(
                jsonb_agg(jsonb_build_object('status', m."status", 'cnt', m."count")),
                '[]'::jsonb
            )
            FROM (
                SELECT m."status", count(*) AS "count"
                FROM public."maintenance_requests" AS m
                GROUP BY m."status"
            ) AS m
        ),
        'top_tenants', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'tenant_id', top."tenant_id",
                        'full_name', top."full_name",
                        'total_paid', top."total_paid"
                    )
                    ORDER BY top."total_paid" DESC
                ),
                '[]'::jsonb
            )
            FROM (
                SELECT
                    t."tenant_id",
                    t."full_name",
                    COALESCE(sum(p."amount"), 0) AS "total_paid"
                FROM public."tenants" AS t
                LEFT JOIN public."payments" AS p
                    ON p."tenant_id" = t."tenant_id"
                   AND p."status" = 'Paid'
                GROUP BY t."tenant_id", t."full_name"
                ORDER BY COALESCE(sum(p."amount"), 0) DESC
                LIMIT 10
            ) AS top
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.get_admin_analytics_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_snapshot() TO service_role;
