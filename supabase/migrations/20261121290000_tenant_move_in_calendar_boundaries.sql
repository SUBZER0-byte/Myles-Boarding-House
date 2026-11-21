CREATE OR REPLACE FUNCTION public.get_guest_booking_boundary_dates(
    p_room_id integer,
    p_from date,
    p_until date
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
    IF p_room_id IS NULL
       OR p_from IS NULL
       OR p_until <= p_from
       OR p_until > p_from + 366 THEN
        RAISE EXCEPTION 'Choose a valid room date range';
    END IF;

    WITH exact_dates AS (
        SELECT day
          FROM public."tenants" AS t
         CROSS JOIN LATERAL generate_series(
            GREATEST(t."move_in_date"::date, p_from)::date,
            LEAST(COALESCE(t."move_out_date", t."move_in_date")::date, p_until)::date,
            '1 day'::interval
         ) AS day
         WHERE t."room_id" = p_room_id
            AND t."is_active" = 1
        UNION
        SELECT day
          FROM public."bookings" AS b
         CROSS JOIN LATERAL generate_series(
            GREATEST(b."move_in_date"::date, p_from)::date,
            LEAST(COALESCE(b."check_out_date", b."move_in_date")::date, p_until)::date,
            '1 day'::interval
         ) AS day
         WHERE b."room_id" = p_room_id
            AND lower(btrim(COALESCE(b."status", ''))) IN ('pending', 'pending verification')
    )
    SELECT COALESCE(jsonb_agg(day::text ORDER BY day), '[]'::jsonb)
      INTO unavailable
      FROM exact_dates;

    RETURN unavailable;
END;
$$;

REVOKE ALL ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) TO authenticated;

DROP POLICY IF EXISTS "authenticated_can_read_active_tenant_move_in_dates" ON public."tenants";
CREATE POLICY "authenticated_can_read_active_tenant_move_in_dates"
ON public."tenants"
FOR SELECT
TO authenticated
USING ("is_active" = 1);

DROP POLICY IF EXISTS "authenticated_can_read_pending_booking_move_in_dates" ON public."bookings";
CREATE POLICY "authenticated_can_read_pending_booking_move_in_dates"
ON public."bookings"
FOR SELECT
TO authenticated
USING (lower(btrim(COALESCE("status", ''))) IN ('pending', 'pending verification'));
