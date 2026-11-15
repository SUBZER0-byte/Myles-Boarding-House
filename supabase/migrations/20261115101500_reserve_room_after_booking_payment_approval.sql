CREATE OR REPLACE FUNCTION public.sync_confirmed_booking_room_status(booking_id_value integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    room_id_value integer;
    availability_status_value text;
BEGIN
    SELECT b."room_id"
      INTO room_id_value
      FROM public."bookings" AS b
     WHERE b."booking_id" = booking_id_value;
    IF NOT FOUND OR room_id_value IS NULL THEN
        RAISE EXCEPTION 'Room was not found for confirmed booking';
    END IF;

    SELECT a."status"
      INTO availability_status_value
      FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS a
     WHERE a."room_id" = room_id_value;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room availability could not be calculated for confirmed booking';
    END IF;

    UPDATE public."rooms" AS target
       SET "status" = CASE
           WHEN target."status" = 'Maintenance' THEN 'Maintenance'
           WHEN availability_status_value = 'Occupied' THEN 'Occupied'
           WHEN EXISTS (
               SELECT 1
                 FROM public."bookings" AS future_booking
                WHERE future_booking."room_id" = room_id_value
                  AND future_booking."status" = 'Confirmed'
                  AND future_booking."move_in_date" > CURRENT_DATE
                  AND future_booking."check_out_date" > CURRENT_DATE
           ) THEN 'Reserved'
           ELSE availability_status_value
       END
     WHERE target."room_id" = room_id_value;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room was not found for confirmed booking';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_guest_booking_to_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.promote_booking_guest_to_tenant(NEW."booking_id");
    PERFORM public.sync_confirmed_booking_room_status(NEW."booking_id");
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_guest_on_gcash_payment_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    booking_status_value text;
BEGIN
    SELECT b."status"
      INTO booking_status_value
      FROM public."bookings" AS b
     WHERE b."booking_id" = NEW."booking_id"
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking was not found for payment confirmation';
    END IF;

    IF booking_status_value IN ('Pending', 'Pending Verification') THEN
        UPDATE public."bookings"
           SET "status" = 'Confirmed',
               "updated_at" = CURRENT_TIMESTAMP
         WHERE "booking_id" = NEW."booking_id"
           AND "status" IN ('Pending', 'Pending Verification');
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Booking status changed during payment confirmation';
        END IF;
    ELSIF booking_status_value IN ('Confirmed', 'Checked In', 'Active') THEN
        PERFORM public.promote_booking_guest_to_tenant(NEW."booking_id");
        PERFORM public.sync_confirmed_booking_room_status(NEW."booking_id");
    ELSE
        RAISE EXCEPTION 'Booking status % cannot be confirmed', booking_status_value;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_admin_rooms()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    result jsonb;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    SELECT COALESCE(jsonb_agg(room_row ORDER BY room_number), '[]'::jsonb)
      INTO result
      FROM (
          SELECT r."room_number",
                 jsonb_build_object(
                     'room_id', r."room_id",
                     'room_number', r."room_number",
                     'room_type', r."room_type",
                     'capacity', r."capacity",
                     'monthly_rent', r."monthly_rent",
                     'status', CASE
                         WHEN r."status" = 'Maintenance' THEN 'Maintenance'
                         WHEN availability."status" = 'Occupied' THEN 'Occupied'
                         WHEN EXISTS (
                             SELECT 1
                               FROM public."bookings" AS b
                              WHERE b."room_id" = r."room_id"
                                AND b."status" = 'Confirmed'
                                AND b."move_in_date" > CURRENT_DATE
                                AND b."check_out_date" > CURRENT_DATE
                         ) THEN 'Reserved'
                         ELSE COALESCE(availability."status", r."status")
                     END,
                     'description', r."description",
                     'image', r."image",
                     'occupants', (
                         SELECT count(*)::integer
                           FROM public."tenants" AS t
                          WHERE t."room_id" = r."room_id"
                            AND t."is_active" = 1
                            AND t."move_in_date" <= CURRENT_DATE
                            AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
                     )
                 ) AS room_row
            FROM public."rooms" AS r
            LEFT JOIN LATERAL (
                SELECT a."status"
                  FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS a
                 WHERE a."room_id" = r."room_id"
            ) AS availability ON true
      ) AS rooms;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_confirmed_booking_room_status(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_guest_booking_to_tenant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_guest_on_gcash_payment_confirmation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_admin_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_rooms() TO authenticated;
