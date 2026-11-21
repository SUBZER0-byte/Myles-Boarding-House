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
        SELECT t."move_out_date" AS day
          FROM public."tenants" AS t
         WHERE t."room_id" = p_room_id
            AND t."is_active" = 1
            AND t."move_out_date" BETWEEN p_from AND p_until
        UNION
        SELECT b."move_in_date" AS day
          FROM public."bookings" AS b
         WHERE b."room_id" = p_room_id
            AND lower(btrim(COALESCE(b."status", ''))) IN ('pending', 'pending verification')
            AND b."move_in_date" BETWEEN p_from AND p_until
        UNION
        SELECT b."check_out_date" AS day
          FROM public."bookings" AS b
         WHERE b."room_id" = p_room_id
            AND lower(btrim(COALESCE(b."status", ''))) IN ('pending', 'pending verification')
            AND b."check_out_date" BETWEEN p_from AND p_until
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

CREATE OR REPLACE FUNCTION public.prevent_duplicate_room_move_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW."room_id" IS NOT NULL AND NEW."check_out_date" IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public."tenants" AS t
       WHERE t."room_id" = NEW."room_id"
         AND t."is_active" = 1
         AND t."move_out_date" = NEW."check_out_date"
    ) THEN
      RAISE EXCEPTION 'This check-out date is already taken by another tenant for this room';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public."bookings" AS b
       WHERE b."booking_id" IS DISTINCT FROM NEW."booking_id"
         AND b."room_id" = NEW."room_id"
         AND b."check_out_date" = NEW."check_out_date"
         AND lower(btrim(COALESCE(b."status", ''))) IN ('pending', 'pending verification')
    ) THEN
      RAISE EXCEPTION 'This check-out date is already taken by another pending booking for this room';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_prevent_duplicate_move_out ON public."bookings";
CREATE TRIGGER bookings_prevent_duplicate_move_out
BEFORE INSERT OR UPDATE OF "check_out_date", "room_id"
ON public."bookings"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_room_move_out();
