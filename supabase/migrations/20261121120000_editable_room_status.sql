CREATE OR REPLACE FUNCTION public.set_my_admin_room_status(p_room_id integer, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  resolved_status text;
  room_capacity integer;
  available_beds bigint;
BEGIN
  IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;
  IF p_status NOT IN ('Available', 'Occupied', 'Reserved', 'Maintenance') THEN
    RAISE EXCEPTION 'Select a valid room status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."rooms" WHERE "room_id" = p_room_id) THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF p_status IN ('Available', 'Occupied') THEN
    SELECT a."capacity", a."available_beds"
      INTO room_capacity, available_beds
      FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS a
     WHERE a."room_id" = p_room_id;

    IF room_capacity IS NOT NULL
       AND available_beds IS NOT NULL
       AND room_capacity > 0
       AND available_beds = 0 THEN
      resolved_status := 'Occupied';
    ELSE
      resolved_status := 'Available';
    END IF;
  ELSE
    resolved_status := p_status;
  END IF;

  UPDATE public."rooms"
     SET "status" = resolved_status
   WHERE "room_id" = p_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_admin_room_status(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_admin_room_status(integer, text) TO authenticated;
