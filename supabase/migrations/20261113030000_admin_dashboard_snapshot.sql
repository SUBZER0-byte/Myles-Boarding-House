CREATE OR REPLACE FUNCTION public.get_admin_dashboard_data()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    WITH month_bounds AS (
        SELECT date_trunc('month', timezone('Asia/Manila', statement_timestamp())) AS month_start
    ),
    complaint_stats AS (
        SELECT
            count(*) FILTER (WHERE lower("status") IN ('open', 'submitted', 'acknowledged')) AS open_count,
            count(*) FILTER (WHERE lower("status") = 'in progress') AS in_progress_count,
            count(*) FILTER (WHERE lower("status") = 'resolved') AS resolved_count,
            count(*) FILTER (WHERE lower("status") IN ('cancelled', 'canceled')) AS cancelled_count
        FROM public."complaints"
    ),
    maintenance_stats AS (
        SELECT
            count(*) FILTER (WHERE lower("status") IN ('pending', 'submitted', 'acknowledged')) AS pending_count,
            count(*) FILTER (WHERE lower("status") IN ('ongoing', 'in progress')) AS ongoing_count,
            count(*) FILTER (WHERE lower("status") IN ('completed', 'resolved')) AS completed_count,
            count(*) FILTER (WHERE lower("status") IN ('cancelled', 'canceled')) AS cancelled_count
        FROM public."maintenance_requests"
    )
    SELECT jsonb_build_object(
        'totalRooms', (SELECT count(*) FROM public."rooms"),
        'occupiedRooms', (SELECT count(*) FROM public."rooms" WHERE lower("status") = 'occupied'),
        'availableRooms', (SELECT count(*) FROM public."rooms" WHERE lower("status") = 'available'),
        'reservedRooms', (SELECT count(*) FROM public."rooms" WHERE lower("status") = 'reserved'),
        'totalTenants', (SELECT count(*) FROM public."tenants" WHERE "is_active" = 1),
        'monthlyRevenue', (
            SELECT COALESCE(sum(p."amount"), 0)
            FROM public."payments" AS p
            CROSS JOIN month_bounds AS mb
            WHERE p."status" = 'Paid'
              AND p."paid_at" >= mb.month_start
              AND p."paid_at" < mb.month_start + interval '1 month'
        ),
        'pendingPayments', (
            SELECT count(*)
            FROM public."payments"
            WHERE "status" IN ('Pending', 'Overdue')
        ),
        'openComplaints', cs.open_count + cs.in_progress_count,
        'complaintStats', jsonb_build_object(
            'open', cs.open_count,
            'inProgress', cs.in_progress_count,
            'resolved', cs.resolved_count,
            'cancelled', cs.cancelled_count
        ),
        'pendingMaintenance', ms.pending_count,
        'ongoingMaintenance', ms.ongoing_count,
        'completedMaintenance', ms.completed_count,
        'cancelledMaintenance', ms.cancelled_count,
        'maintenanceRooms', (
            SELECT count(*) FROM public."rooms" WHERE lower("status") = 'maintenance'
        )
    )
    FROM complaint_stats AS cs
    CROSS JOIN maintenance_stats AS ms
$$;

CREATE OR REPLACE FUNCTION public.get_admin_recent_activity()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    WITH recent_payments AS (
        SELECT
            'payment'::text AS "type",
            t."full_name" || ' paid ₱' || to_char(p."amount", 'FM999,999,999,999,990.00') AS "message",
            p."paid_at" AS "timestamp"
        FROM public."payments" AS p
        INNER JOIN public."tenants" AS t ON t."tenant_id" = p."tenant_id"
        WHERE p."status" = 'Paid'
          AND p."paid_at" IS NOT NULL
        ORDER BY p."paid_at" DESC
        LIMIT 5
    ),
    recent_complaints AS (
        SELECT
            'complaint'::text AS "type",
            t."full_name" || ' filed: ' || c."title" AS "message",
            c."created_at" AS "timestamp"
        FROM public."complaints" AS c
        INNER JOIN public."tenants" AS t ON t."tenant_id" = c."tenant_id"
        ORDER BY c."created_at" DESC
        LIMIT 5
    ),
    combined AS (
        SELECT * FROM recent_payments
        UNION ALL
        SELECT * FROM recent_complaints
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'type', recent."type",
                'message', recent."message",
                'timestamp', recent."timestamp"
            )
            ORDER BY recent."timestamp" DESC
        ),
        '[]'::jsonb
    )
    FROM (
        SELECT * FROM combined
        ORDER BY "timestamp" DESC
        LIMIT 10
    ) AS recent
$$;

REVOKE ALL ON FUNCTION public.get_admin_dashboard_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_recent_activity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_data() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_recent_activity() TO service_role;

NOTIFY pgrst, 'reload schema';
