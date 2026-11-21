CREATE OR REPLACE FUNCTION public.sync_confirmed_booking_room_status(booking_id_value integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  room_id_value integer;
  room_capacity integer;
  current_status text;
  tenant_beds bigint;
  booking_beds bigint;
  hold_beds bigint;
  occupied_beds bigint;
BEGIN
  SELECT b."room_id"
    INTO room_id_value
    FROM public."bookings" AS b
   WHERE b."booking_id" = booking_id_value;
  IF NOT FOUND OR room_id_value IS NULL THEN
    RAISE EXCEPTION 'Room was not found for confirmed booking';
  END IF;

  SELECT r."capacity", r."status"
    INTO room_capacity, current_status
    FROM public."rooms" AS r
   WHERE r."room_id" = room_id_value
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room was not found for confirmed booking';
  END IF;
  IF current_status = 'Maintenance' THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
           CASE WHEN t."reservation_type" = 'entire_room' THEN room_capacity
                ELSE LEAST(GREATEST(t."occupant_count", 1), room_capacity) END
         ), 0)::bigint
    INTO tenant_beds
    FROM public."tenants" AS t
   WHERE t."room_id" = room_id_value
     AND t."is_active" = 1
     AND t."move_in_date" < CURRENT_DATE + 1
     AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE;

  SELECT COALESCE(SUM(
           CASE WHEN b."reservation_type" = 'entire_room' THEN room_capacity
                ELSE LEAST(GREATEST(b."occupant_count", 1), room_capacity) END
         ), 0)::bigint
    INTO booking_beds
    FROM public."bookings" AS b
   WHERE b."room_id" = room_id_value
     AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
     AND b."move_in_date" < CURRENT_DATE + 1
     AND b."check_out_date" > CURRENT_DATE
     AND NOT EXISTS (
       SELECT 1
         FROM public."tenants" AS t
        WHERE t."room_id" = b."room_id"
          AND t."is_active" = 1
          AND lower(btrim(t."email")) = lower(btrim(b."email"))
     );

  SELECT COALESCE(SUM(
           CASE WHEN h."reservation_type" = 'entire_room' THEN room_capacity
                ELSE LEAST(GREATEST(h."occupant_count", 1), room_capacity) END
         ), 0)::bigint
    INTO hold_beds
    FROM public."booking_room_holds" AS h
   WHERE h."room_id" = room_id_value
     AND h."expires_at" > CURRENT_TIMESTAMP;

  occupied_beds := COALESCE(tenant_beds, 0) + COALESCE(booking_beds, 0) + COALESCE(hold_beds, 0);

  UPDATE public."rooms"
     SET "status" = CASE
       WHEN room_capacity > 0 AND occupied_beds >= room_capacity THEN 'Occupied'
       WHEN current_status = 'Reserved' THEN 'Reserved'
       ELSE 'Available'
     END
   WHERE "room_id" = room_id_value;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_confirmed_booking_room_status(integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recalculate_tenant_mutation_room_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  room_id_value integer;
  room_capacity integer;
  current_status text;
  tenant_beds bigint;
  booking_beds bigint;
  hold_beds bigint;
  occupied_beds bigint;
BEGIN
  room_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD."room_id" ELSE NEW."room_id" END;
  IF room_id_value IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT r."capacity", r."status"
    INTO room_capacity, current_status
    FROM public."rooms" AS r
   WHERE r."room_id" = room_id_value
   FOR UPDATE;
  IF NOT FOUND OR current_status = 'Maintenance' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(
           CASE WHEN t."reservation_type" = 'entire_room' THEN room_capacity
                ELSE LEAST(GREATEST(t."occupant_count", 1), room_capacity) END
         ), 0)::bigint
    INTO tenant_beds
    FROM public."tenants" AS t
   WHERE t."room_id" = room_id_value
     AND t."is_active" = 1
     AND t."move_in_date" < CURRENT_DATE + 1
     AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE;

  SELECT COALESCE(SUM(
           CASE WHEN b."reservation_type" = 'entire_room' THEN room_capacity
                ELSE LEAST(GREATEST(b."occupant_count", 1), room_capacity) END
         ), 0)::bigint
    INTO booking_beds
    FROM public."bookings" AS b
   WHERE b."room_id" = room_id_value
     AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
     AND b."move_in_date" < CURRENT_DATE + 1
     AND b."check_out_date" > CURRENT_DATE
     AND NOT EXISTS (
       SELECT 1
         FROM public."tenants" AS t
        WHERE t."room_id" = b."room_id"
          AND t."is_active" = 1
          AND lower(btrim(t."email")) = lower(btrim(b."email"))
     );

  SELECT COALESCE(SUM(
           CASE WHEN h."reservation_type" = 'entire_room' THEN room_capacity
                ELSE LEAST(GREATEST(h."occupant_count", 1), room_capacity) END
         ), 0)::bigint
    INTO hold_beds
    FROM public."booking_room_holds" AS h
   WHERE h."room_id" = room_id_value
     AND h."expires_at" > CURRENT_TIMESTAMP;

  occupied_beds := COALESCE(tenant_beds, 0) + COALESCE(booking_beds, 0) + COALESCE(hold_beds, 0);

  UPDATE public."rooms"
     SET "status" = CASE
       WHEN room_capacity > 0 AND occupied_beds >= room_capacity THEN 'Occupied'
       WHEN current_status = 'Reserved' THEN 'Reserved'
       ELSE 'Available'
     END
   WHERE "room_id" = room_id_value;

  IF TG_OP = 'UPDATE' AND OLD."room_id" IS DISTINCT FROM NEW."room_id" AND OLD."room_id" IS NOT NULL THEN
    room_id_value := OLD."room_id";
    SELECT r."capacity", r."status"
      INTO room_capacity, current_status
      FROM public."rooms" AS r
     WHERE r."room_id" = room_id_value;
    IF FOUND AND current_status <> 'Maintenance' THEN
      SELECT COALESCE(SUM(
               CASE WHEN t."reservation_type" = 'entire_room' THEN room_capacity
                    ELSE LEAST(GREATEST(t."occupant_count", 1), room_capacity) END
             ), 0)::bigint
        INTO tenant_beds
        FROM public."tenants" AS t
       WHERE t."room_id" = room_id_value
         AND t."is_active" = 1
         AND t."move_in_date" < CURRENT_DATE + 1
         AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE;

      occupied_beds := COALESCE(tenant_beds, 0);
      UPDATE public."rooms"
         SET "status" = CASE
           WHEN room_capacity > 0 AND occupied_beds >= room_capacity THEN 'Occupied'
           ELSE 'Available'
         END
       WHERE "room_id" = room_id_value;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS recalculate_tenant_mutation_room_status ON public."tenants";
CREATE TRIGGER recalculate_tenant_mutation_room_status
AFTER INSERT OR UPDATE OR DELETE ON public."tenants"
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_tenant_mutation_room_status();
