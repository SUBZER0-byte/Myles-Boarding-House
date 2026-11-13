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
           AND (
               b."status" <> 'Pending'
               OR b."payment_expires_at" > CURRENT_TIMESTAMP
               OR EXISTS (
                   SELECT 1
                     FROM public."booking_initial_payment_requests" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."status" IN ('Submitted', 'Confirmed')
               )
               OR EXISTS (
                   SELECT 1
                     FROM public."payments" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."payment_type" = CASE
                          WHEN b."payment_plan" = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                          ELSE 'Security Deposit'
                      END
                      AND ip."status" IN ('Submitted', 'Confirmed', 'Paid')
               )
           )
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
    reservation_counts AS (
        SELECT b."room_id",
               count(*) FILTER (WHERE b."status" = 'Confirmed') AS confirmed_count,
               count(*) FILTER (WHERE b."status" IN ('Checked In', 'Active')) AS active_count,
               count(*) FILTER (
                   WHERE b."status" = 'Pending'
                     AND b."check_out_date" > CURRENT_DATE
               ) AS temporary_count,
               count(*) FILTER (
                   WHERE b."status" IN ('Pending Verification', 'Confirmed')
                     AND b."check_out_date" > CURRENT_DATE
               ) AS reserved_count
          FROM public."bookings" AS b
         WHERE b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND b."move_in_date" < p_check_out_date
           AND b."check_out_date" > p_check_in_date
           AND (
               b."status" <> 'Pending'
               OR b."payment_expires_at" > CURRENT_TIMESTAMP
               OR EXISTS (
                   SELECT 1
                     FROM public."booking_initial_payment_requests" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."status" IN ('Submitted', 'Confirmed')
               )
               OR EXISTS (
                   SELECT 1
                     FROM public."payments" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."payment_type" = CASE
                          WHEN b."payment_plan" = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                          ELSE 'Security Deposit'
                      END
                      AND ip."status" IN ('Submitted', 'Confirmed', 'Paid')
               )
           )
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
    occupancy AS (
        SELECT r."room_id",
               COALESCE(tl.beds, 0) + COALESCE(bl.beds, 0) + COALESCE(h.beds, 0) AS occupied,
               COALESCE(tl.beds, 0) AS tenant_beds,
               COALESCE(bl.beds, 0) AS booking_beds,
               COALESCE(h.beds, 0) AS hold_beds,
               COALESCE(rc.confirmed_count, 0) AS confirmed_count,
               COALESCE(rc.active_count, 0) AS active_count,
               COALESCE(rc.temporary_count, 0) AS temporary_count,
               COALESCE(rc.reserved_count, 0) AS reserved_count
          FROM public."rooms" AS r
          LEFT JOIN tenant_load AS tl ON tl."room_id" = r."room_id"
          LEFT JOIN booking_load AS bl ON bl."room_id" = r."room_id"
          LEFT JOIN holds AS h ON h."room_id" = r."room_id"
          LEFT JOIN reservation_counts AS rc ON rc."room_id" = r."room_id"
    )
    SELECT r."room_id",
           r."room_number",
           r."room_type",
           r."capacity",
           r."monthly_rent",
           r."description",
           CASE
               WHEN r."status" = 'Maintenance' THEN 'Maintenance'
               WHEN o.confirmed_count > 0 OR o.tenant_beds > 0 OR o.active_count > 0 THEN 'Occupied'
               WHEN o.reserved_count > 0 THEN 'Reserved'
               WHEN o.temporary_count > 0 OR o.hold_beds > 0 THEN 'Reserving'
               WHEN o.occupied >= r."capacity" THEN 'Reserved'
               WHEN r."status" IN ('Reserved', 'Occupied', 'Reserving') THEN 'Available'
               ELSE r."status"
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
