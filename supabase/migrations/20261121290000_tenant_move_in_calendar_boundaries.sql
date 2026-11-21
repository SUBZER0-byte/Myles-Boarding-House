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
    caller_email text;
    unavailable jsonb;
BEGIN
    SELECT lower(btrim(u."email"))
      INTO caller_email
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."is_active" = 1
     LIMIT 1;
    IF caller_email IS NULL THEN
        RAISE EXCEPTION 'Guest access is required';
    END IF;
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
           AND lower(btrim(COALESCE(t."email", ''))) <> caller_email
        UNION
        SELECT b."move_in_date" AS day
          FROM public."bookings" AS b
         WHERE b."room_id" = p_room_id
           AND b."status" IN ('Pending', 'Pending Verification')
           AND b."move_in_date" BETWEEN p_from AND p_until
           AND lower(btrim(COALESCE(b."email", ''))) <> caller_email
        UNION
        SELECT h."move_in_date" AS day
          FROM public."booking_room_holds" AS h
         WHERE h."room_id" = p_room_id
           AND h."move_in_date" BETWEEN p_from AND p_until
           AND h."expires_at" > CURRENT_TIMESTAMP
           AND lower(btrim(COALESCE(h."email", ''))) <> caller_email
    )
    SELECT COALESCE(jsonb_agg(day::text ORDER BY day), '[]'::jsonb)
      INTO unavailable
      FROM exact_dates;

    RETURN unavailable;
END;
$$;

REVOKE ALL ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) TO authenticated;
