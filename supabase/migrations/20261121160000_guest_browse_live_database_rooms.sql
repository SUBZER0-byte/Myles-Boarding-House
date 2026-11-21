CREATE OR REPLACE FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(
    p_check_in_date date,
    p_check_out_date date
)
RETURNS TABLE (
    "room_id" integer,
    "room_number" varchar(40),
    "floor_number" smallint,
    "capacity" integer,
    "monthly_rent" numeric(10,2),
    "description" text,
    "status" text,
    "image" varchar(255),
    "occupants" bigint,
    "available_beds" bigint,
    "available_for_dates" boolean,
    "occupant_genders" text[],
    "has_active_booking" boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_guest_id integer;
BEGIN
    IF p_check_in_date IS NULL OR p_check_out_date IS NULL
       OR p_check_out_date <= p_check_in_date
       OR p_check_in_date < CURRENT_DATE THEN
        RAISE EXCEPTION 'Choose a valid stay starting today or later';
    END IF;

    SELECT u."user_id"
      INTO current_guest_id
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."user_type" = 'Guest'
       AND u."is_active" = 1
     LIMIT 1;

    RETURN QUERY
    SELECT r."room_id",
           r."room_number",
           r."floor_number",
           r."capacity",
           r."monthly_rent",
           r."description",
           r."status",
           r."image",
           COALESCE(tenant_load.occupants, 0)::bigint,
           GREATEST(
             r."capacity" - (
               COALESCE(tenant_load.tenant_beds, 0)
               + COALESCE(booking_load.booking_beds, 0)
               + COALESCE(hold_load.hold_beds, 0)
             ),
             0
           )::bigint,
           CASE
             WHEN r."status" = 'Maintenance' THEN false
             ELSE (
               r."capacity" - (
                 COALESCE(tenant_load.tenant_beds, 0)
                 + COALESCE(booking_load.booking_beds, 0)
                 + COALESCE(hold_load.hold_beds, 0)
               )
             ) > 0
           END,
           public.get_room_occupant_genders(r."room_id"),
           public.guest_has_active_room_booking(current_guest_id, r."room_id")
      FROM public."rooms" AS r
      LEFT JOIN LATERAL (
        SELECT count(*)::bigint AS occupants,
               COALESCE(SUM(
                 CASE WHEN t."reservation_type" = 'entire_room' THEN r."capacity"
                      ELSE LEAST(GREATEST(t."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS tenant_beds
          FROM public."tenants" AS t
         WHERE t."room_id" = r."room_id"
           AND t."is_active" = 1
           AND t."move_in_date" < p_check_out_date
           AND COALESCE(t."move_out_date", '9999-12-31'::date) > p_check_in_date
      ) AS tenant_load ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(
                 CASE WHEN b."reservation_type" = 'entire_room' THEN r."capacity"
                      ELSE LEAST(GREATEST(b."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS booking_beds
          FROM public."bookings" AS b
         WHERE b."room_id" = r."room_id"
           AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND b."move_in_date" < p_check_out_date
           AND b."check_out_date" > p_check_in_date
           AND NOT EXISTS (
             SELECT 1
               FROM public."tenants" AS t
              WHERE t."room_id" = b."room_id"
                AND t."is_active" = 1
                AND lower(btrim(t."email")) = lower(btrim(b."email"))
           )
      ) AS booking_load ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(
                 CASE WHEN h."reservation_type" = 'entire_room' THEN r."capacity"
                      ELSE LEAST(GREATEST(h."occupant_count", 1), r."capacity") END
               ), 0)::bigint AS hold_beds
          FROM public."booking_room_holds" AS h
         WHERE h."room_id" = r."room_id"
           AND h."expires_at" > CURRENT_TIMESTAMP
           AND (
             h."move_in_date" IS NULL
             OR h."check_out_date" IS NULL
             OR (h."move_in_date" < p_check_out_date AND h."check_out_date" > p_check_in_date)
           )
      ) AS hold_load ON true
     ORDER BY r."room_number" ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_for_guest_browse_with_booking_state(date, date) TO anon, authenticated;
