-- Confirmed guest bookings consume exactly one bed.
-- Status is recalculated from actual occupied beds, never forced to Occupied.

CREATE OR REPLACE FUNCTION public.confirmed_booking_deduct_one_room_bed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.reservation_type := 'capacity_based';
  NEW.occupant_count := 1;

  IF NEW.status IN ('Confirmed', 'Checked In', 'Active') THEN
    PERFORM public.promote_booking_guest_to_tenant(NEW.booking_id);
  END IF;

  IF NEW.status IN ('Confirmed', 'Checked In', 'Active', 'Cancelled', 'Rejected', 'Checked Out', 'Refunded', 'Expired') THEN
    PERFORM public.sync_confirmed_booking_room_status(NEW.booking_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_confirmed_deduct_one_bed ON public.bookings;

CREATE TRIGGER bookings_confirmed_deduct_one_bed
BEFORE INSERT OR UPDATE OF status, reservation_type, occupant_count
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.confirmed_booking_deduct_one_room_bed();

UPDATE public.bookings
SET reservation_type = 'capacity_based',
    occupant_count = 1
WHERE reservation_type IS DISTINCT FROM 'capacity_based'
   OR occupant_count IS DISTINCT FROM 1;
