UPDATE public."tenants"
   SET "reservation_type" = 'capacity_based',
       "occupant_count" = 1
 WHERE "reservation_type" IS DISTINCT FROM 'capacity_based'
    OR "occupant_count" IS DISTINCT FROM 1;

UPDATE public."bookings"
   SET "reservation_type" = 'capacity_based',
       "occupant_count" = 1
 WHERE "reservation_type" IS DISTINCT FROM 'capacity_based'
    OR "occupant_count" IS DISTINCT FROM 1;

CREATE OR REPLACE FUNCTION public.force_one_user_one_room_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW."reservation_type" := 'capacity_based';
  NEW."occupant_count" := 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_force_one_user_one_capacity ON public."tenants";
CREATE TRIGGER tenants_force_one_user_one_capacity
BEFORE INSERT OR UPDATE OF "reservation_type", "occupant_count"
ON public."tenants"
FOR EACH ROW
EXECUTE FUNCTION public.force_one_user_one_room_capacity();

DROP TRIGGER IF EXISTS bookings_force_one_user_one_capacity ON public."bookings";
CREATE TRIGGER bookings_force_one_user_one_capacity
BEFORE INSERT OR UPDATE OF "reservation_type", "occupant_count"
ON public."bookings"
FOR EACH ROW
EXECUTE FUNCTION public.force_one_user_one_room_capacity();
