DROP TRIGGER IF EXISTS rooms_keep_tenant_assigned_occupied ON public."rooms";
DROP FUNCTION IF EXISTS public.keep_tenant_assigned_room_occupied();

CREATE OR REPLACE FUNCTION public.recalculate_room_status_after_booking_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.sync_confirmed_booking_room_status(NEW."booking_id");
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_recalculate_room_status ON public."bookings";
CREATE TRIGGER bookings_recalculate_room_status
AFTER UPDATE OF "status" ON public."bookings"
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_room_status_after_booking_status_change();
