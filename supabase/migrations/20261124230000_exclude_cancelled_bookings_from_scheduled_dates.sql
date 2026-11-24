CREATE OR REPLACE FUNCTION public.get_admin_tenant_scheduled_dates(
    p_from date,
    p_until date,
    p_tenant_id integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    unavailable jsonb;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_from IS NULL
       OR p_until IS NULL
       OR p_until <= p_from
       OR p_until > p_from + 366 THEN
        RAISE EXCEPTION 'Choose a valid date range';
    END IF;
    IF p_tenant_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM public."tenants" AS t
            WHERE t."tenant_id" = p_tenant_id
       ) THEN
        RAISE EXCEPTION 'Tenant record not found';
    END IF;

    WITH current_tenant AS (
        SELECT t."tenant_id", t."user_id", t."move_in_date", t."move_out_date"
          FROM public."tenants" AS t
         WHERE t."tenant_id" = p_tenant_id
    ),
    scheduled_dates AS (
        SELECT t."move_in_date" AS day
          FROM public."tenants" AS t
         WHERE t."is_active" = 1
           AND t."deleted_at" IS NULL
           AND t."tenant_id" IS DISTINCT FROM p_tenant_id
           AND t."move_in_date" BETWEEN p_from AND p_until
        UNION
        SELECT t."move_out_date" AS day
          FROM public."tenants" AS t
         WHERE t."is_active" = 1
           AND t."deleted_at" IS NULL
           AND t."tenant_id" IS DISTINCT FROM p_tenant_id
           AND t."move_out_date" BETWEEN p_from AND p_until
        UNION
        SELECT b."move_in_date" AS day
          FROM public."bookings" AS b
         WHERE b."move_in_date" BETWEEN p_from AND p_until
           AND lower(btrim(COALESCE(b."status", ''))) NOT IN ('cancelled', 'canceled', 'rejected', 'expired')
           AND (
               lower(btrim(COALESCE(b."status", ''))) IN ('pending', 'pending verification')
               OR EXISTS (
                   SELECT 1
                     FROM public."booking_initial_payment_requests" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."status" = 'Confirmed'
               )
               OR EXISTS (
                   SELECT 1
                     FROM public."payments" AS p
                    WHERE p."booking_id" = b."booking_id"
                      AND p."amount" > 0
                      AND p."status" IN ('Confirmed', 'Paid')
               )
           )
           AND NOT EXISTS (
               SELECT 1
                 FROM current_tenant AS t
                WHERE t."user_id" = b."guest_user_id"
                  AND t."move_in_date" = b."move_in_date"
                  AND t."move_out_date" IS NOT DISTINCT FROM b."check_out_date"
           )
        UNION
        SELECT b."check_out_date" AS day
          FROM public."bookings" AS b
         WHERE b."check_out_date" BETWEEN p_from AND p_until
           AND lower(btrim(COALESCE(b."status", ''))) NOT IN ('cancelled', 'canceled', 'rejected', 'expired')
           AND (
               lower(btrim(COALESCE(b."status", ''))) IN ('pending', 'pending verification')
               OR EXISTS (
                   SELECT 1
                     FROM public."booking_initial_payment_requests" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."status" = 'Confirmed'
               )
               OR EXISTS (
                   SELECT 1
                     FROM public."payments" AS p
                    WHERE p."booking_id" = b."booking_id"
                      AND p."amount" > 0
                      AND p."status" IN ('Confirmed', 'Paid')
               )
           )
           AND NOT EXISTS (
               SELECT 1
                 FROM current_tenant AS t
                WHERE t."user_id" = b."guest_user_id"
                  AND t."move_in_date" = b."move_in_date"
                  AND t."move_out_date" IS NOT DISTINCT FROM b."check_out_date"
           )
    )
    SELECT COALESCE(jsonb_agg(day::text ORDER BY day), '[]'::jsonb)
      INTO unavailable
      FROM scheduled_dates
     WHERE day IS NOT NULL;

    RETURN unavailable;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_tenant_scheduled_dates(date, date, integer)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_tenant_scheduled_dates(date, date, integer)
    TO authenticated;

NOTIFY pgrst, 'reload schema';
