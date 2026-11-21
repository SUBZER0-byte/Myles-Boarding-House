CREATE OR REPLACE FUNCTION public.recalculate_room_status_for_tenant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  room_capacity integer;
  room_status text;
  occupied_beds bigint;
  room_id_value integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    room_id_value := OLD.room_id;
  ELSE
    room_id_value := NEW.room_id;
  END IF;

  IF room_id_value IS NOT NULL THEN
    SELECT r."capacity", r."status"
      INTO room_capacity, room_status
      FROM public."rooms" AS r
     WHERE r."room_id" = room_id_value;

    IF room_status IS NOT NULL AND room_status <> 'Maintenance' THEN
      SELECT
        COALESCE((
          SELECT SUM(CASE WHEN t."reservation_type" = 'entire_room' THEN r."capacity"
                          ELSE LEAST(GREATEST(t."occupant_count", 1), r."capacity") END)
            FROM public."tenants" AS t
            INNER JOIN public."rooms" AS r ON r."room_id" = t."room_id"
           WHERE t."room_id" = room_id_value AND t."is_active" = 1
             AND t."move_in_date" < CURRENT_DATE + 1
             AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
        ), 0)
        +
        COALESCE((
          SELECT SUM(CASE WHEN b."reservation_type" = 'entire_room' THEN r."capacity"
                          ELSE LEAST(GREATEST(b."occupant_count", 1), r."capacity") END)
            FROM public."bookings" AS b
            INNER JOIN public."rooms" AS r ON r."room_id" = b."room_id"
           WHERE b."room_id" = room_id_value
             AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
             AND b."move_in_date" < CURRENT_DATE + 1
             AND b."check_out_date" > CURRENT_DATE
        ), 0)
        +
        COALESCE((
          SELECT SUM(CASE WHEN h."reservation_type" = 'entire_room' THEN r."capacity"
                          ELSE LEAST(GREATEST(h."occupant_count", 1), r."capacity") END)
            FROM public."booking_room_holds" AS h
            INNER JOIN public."rooms" AS r ON r."room_id" = h."room_id"
           WHERE h."room_id" = room_id_value
             AND h."expires_at" > CURRENT_TIMESTAMP
        ), 0)
        INTO occupied_beds;

      UPDATE public."rooms"
         SET "status" = CASE
           WHEN room_capacity > 0 AND COALESCE(occupied_beds, 0) >= room_capacity THEN 'Occupied'
           WHEN room_status = 'Reserved' THEN 'Reserved'
           ELSE 'Available'
         END
       WHERE "room_id" = room_id_value;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.room_id IS DISTINCT FROM NEW.room_id AND OLD.room_id IS NOT NULL THEN
    room_id_value := OLD.room_id;
    SELECT r."capacity", r."status"
      INTO room_capacity, room_status
      FROM public."rooms" AS r
     WHERE r."room_id" = room_id_value;
    IF room_status IS NOT NULL AND room_status <> 'Maintenance' THEN
      SELECT
        COALESCE((SELECT SUM(CASE WHEN t."reservation_type" = 'entire_room' THEN r."capacity"
                                  ELSE LEAST(GREATEST(t."occupant_count", 1), r."capacity") END)
                    FROM public."tenants" AS t INNER JOIN public."rooms" AS r ON r."room_id" = t."room_id"
                   WHERE t."room_id" = room_id_value AND t."is_active" = 1
                     AND t."move_in_date" < CURRENT_DATE + 1
                     AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE), 0)
        + COALESCE((SELECT SUM(CASE WHEN b."reservation_type" = 'entire_room' THEN r."capacity"
                                   ELSE LEAST(GREATEST(b."occupant_count", 1), r."capacity") END)
                      FROM public."bookings" AS b INNER JOIN public."rooms" AS r ON r."room_id" = b."room_id"
                     WHERE b."room_id" = room_id_value
                       AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
                       AND b."move_in_date" < CURRENT_DATE + 1
                       AND b."check_out_date" > CURRENT_DATE), 0)
        + COALESCE((SELECT SUM(CASE WHEN h."reservation_type" = 'entire_room' THEN r."capacity"
                                   ELSE LEAST(GREATEST(h."occupant_count", 1), r."capacity") END)
                      FROM public."booking_room_holds" AS h INNER JOIN public."rooms" AS r ON r."room_id" = h."room_id"
                     WHERE h."room_id" = room_id_value AND h."expires_at" > CURRENT_TIMESTAMP), 0)
        INTO occupied_beds;
      UPDATE public."rooms"
         SET "status" = CASE
           WHEN room_capacity > 0 AND COALESCE(occupied_beds, 0) >= room_capacity THEN 'Occupied'
           WHEN room_status = 'Reserved' THEN 'Reserved'
           ELSE 'Available'
         END
       WHERE "room_id" = room_id_value;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS recalculate_room_status_after_tenant_change ON public."tenants";
CREATE TRIGGER recalculate_room_status_after_tenant_change
AFTER INSERT OR UPDATE OR DELETE ON public."tenants"
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_room_status_for_tenant_change();

CREATE OR REPLACE FUNCTION public.get_public_rooms_for_dates(
    p_check_in_date date,
    p_check_out_date date
)
RETURNS TABLE (
    "room_id" integer,
    "room_number" varchar(40),
    "room_type" varchar(80),
    "capacity" integer,
    "monthly_rent" numeric(10,2),
    "description" text,
    "status" text,
    "image" varchar(255),
    "occupants" bigint,
    "available_beds" bigint,
    "available_for_dates" boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_email text;
BEGIN
    IF p_check_in_date IS NULL OR p_check_out_date IS NULL
       OR p_check_in_date < CURRENT_DATE
       OR p_check_out_date <= p_check_in_date THEN
        RAISE EXCEPTION 'Choose a valid stay starting today or later';
    END IF;

    SELECT lower(btrim(u."email"))
      INTO caller_email
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."is_active" = 1
     LIMIT 1;

    RETURN QUERY
    WITH tenant_load AS (
        SELECT t."room_id",
               COALESCE(SUM(
                   CASE WHEN t."reservation_type" = 'entire_room' THEN r."capacity"
                        ELSE LEAST(GREATEST(t."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS beds
          FROM public."tenants" AS t
          INNER JOIN public."rooms" AS r ON r."room_id" = t."room_id"
         WHERE t."is_active" = 1
           AND t."move_in_date" < p_check_out_date
           AND COALESCE(t."move_out_date", '9999-12-31'::date) > p_check_in_date
         GROUP BY t."room_id"
    ),
    booking_load AS (
        SELECT b."room_id",
               COALESCE(SUM(
                   CASE WHEN b."reservation_type" = 'entire_room' THEN r."capacity"
                        ELSE LEAST(GREATEST(b."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS beds
          FROM public."bookings" AS b
          INNER JOIN public."rooms" AS r ON r."room_id" = b."room_id"
         WHERE b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND b."move_in_date" < p_check_out_date
           AND b."check_out_date" > p_check_in_date
           AND NOT EXISTS (
               SELECT 1
                 FROM public."tenants" AS t
                WHERE t."room_id" = b."room_id"
                  AND t."is_active" = 1
                  AND lower(btrim(t."email")) = lower(btrim(b."email"))
                  AND t."move_in_date" < b."check_out_date"
                  AND COALESCE(t."move_out_date", '9999-12-31'::date) > b."move_in_date"
           )
         GROUP BY b."room_id"
    ),
    holds AS (
        SELECT h."room_id",
               COALESCE(SUM(
                   CASE WHEN h."reservation_type" = 'entire_room' THEN r."capacity"
                        ELSE LEAST(GREATEST(h."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS beds
          FROM public."booking_room_holds" AS h
          INNER JOIN public."rooms" AS r ON r."room_id" = h."room_id"
         WHERE h."expires_at" > CURRENT_TIMESTAMP
           AND (caller_email IS NULL OR lower(btrim(h."email")) <> caller_email)
           AND (h."move_in_date" IS NULL OR h."check_out_date" IS NULL
                OR (h."move_in_date" < p_check_out_date AND h."check_out_date" > p_check_in_date))
         GROUP BY h."room_id"
    ),
    occupancy AS (
        SELECT r."room_id",
               COALESCE(tl.beds, 0) + COALESCE(bl.beds, 0) + COALESCE(h.beds, 0) AS occupied,
               COALESCE(tl.beds, 0) AS tenant_beds
          FROM public."rooms" AS r
          LEFT JOIN tenant_load AS tl ON tl."room_id" = r."room_id"
          LEFT JOIN booking_load AS bl ON bl."room_id" = r."room_id"
          LEFT JOIN holds AS h ON h."room_id" = r."room_id"
    )
    SELECT r."room_id",
           r."room_number",
           r."room_type",
           r."capacity",
           r."monthly_rent",
           r."description",
           CASE
               WHEN r."status" = 'Maintenance' THEN 'Maintenance'
               WHEN o.occupied >= r."capacity" AND r."capacity" > 0 THEN 'Occupied'
               WHEN r."status" = 'Reserved' THEN 'Reserved'
               ELSE 'Available'
           END,
           r."image",
           o.occupied,
           GREATEST(r."capacity" - o.occupied, 0)::bigint,
           r."status" <> 'Maintenance' AND o.occupied < r."capacity"
      FROM public."rooms" AS r
      INNER JOIN occupancy AS o ON o."room_id" = r."room_id"
     ORDER BY r."room_number" ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_rooms_for_dates(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_for_dates(date, date) TO anon, authenticated;
