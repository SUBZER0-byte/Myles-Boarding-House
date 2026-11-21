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
        SELECT t."move_in_date" AS day
          FROM public."tenants" AS t
         WHERE t."room_id" = p_room_id
           AND t."is_active" = 1
           AND t."move_in_date" BETWEEN p_from AND p_until
        UNION
        SELECT b."move_in_date" AS day
          FROM public."bookings" AS b
         WHERE b."room_id" = p_room_id
            AND lower(btrim(COALESCE(b."status", ''))) IN ('pending', 'pending verification')
           AND b."move_in_date" BETWEEN p_from AND p_until
    )
    SELECT COALESCE(jsonb_agg(day::text ORDER BY day), '[]'::jsonb)
      INTO unavailable
      FROM exact_dates;

    RETURN unavailable;
END;
$$;

REVOKE ALL ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) TO authenticated;
