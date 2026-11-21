CREATE OR REPLACE FUNCTION public.prevent_duplicate_room_move_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW."room_id" IS NOT NULL AND NEW."move_in_date" IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public."tenants" AS t
       WHERE t."room_id" = NEW."room_id"
         AND t."is_active" = 1
         AND t."deleted_at" IS NULL
         AND t."move_in_date" = NEW."move_in_date"
         AND (NEW."guest_user_id" IS NULL OR t."user_id" IS DISTINCT FROM NEW."guest_user_id")
    ) THEN
      RAISE EXCEPTION 'This check-in date is already taken by another tenant for this room';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public."bookings" AS b
       WHERE b."booking_id" IS DISTINCT FROM NEW."booking_id"
         AND b."room_id" = NEW."room_id"
         AND b."move_in_date" = NEW."move_in_date"
         AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
         AND (NEW."guest_user_id" IS NULL OR b."guest_user_id" IS DISTINCT FROM NEW."guest_user_id")
    ) THEN
      RAISE EXCEPTION 'This check-in date is already taken by another guest for this room';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public."booking_room_holds" AS h
       WHERE h."room_id" = NEW."room_id"
         AND h."move_in_date" = NEW."move_in_date"
         AND h."expires_at" > CURRENT_TIMESTAMP
         AND (NEW."guest_user_id" IS NULL OR h."user_id" IS DISTINCT FROM NEW."guest_user_id")
    ) THEN
      RAISE EXCEPTION 'This check-in date is already reserved by another guest for this room';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_prevent_duplicate_move_in ON public."bookings";
CREATE TRIGGER bookings_prevent_duplicate_move_in
BEFORE INSERT OR UPDATE OF "move_in_date", "room_id", "guest_user_id"
ON public."bookings"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_room_move_in();

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
           AND t."deleted_at" IS NULL
           AND t."move_in_date" BETWEEN p_from AND p_until
           AND lower(btrim(t."email")) <> caller_email
        UNION
        SELECT b."move_in_date" AS day
          FROM public."bookings" AS b
         WHERE b."room_id" = p_room_id
           AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND b."move_in_date" BETWEEN p_from AND p_until
           AND lower(btrim(b."email")) <> caller_email
        UNION
        SELECT h."move_in_date" AS day
          FROM public."booking_room_holds" AS h
         WHERE h."room_id" = p_room_id
           AND h."move_in_date" BETWEEN p_from AND p_until
           AND h."expires_at" > CURRENT_TIMESTAMP
           AND lower(btrim(h."email")) <> caller_email
    )
    SELECT COALESCE(jsonb_agg(day::text ORDER BY day), '[]'::jsonb)
      INTO unavailable
      FROM exact_dates;

    RETURN unavailable;
END;
$$;

REVOKE ALL ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guest_booking_boundary_dates(integer, date, date) TO authenticated;
