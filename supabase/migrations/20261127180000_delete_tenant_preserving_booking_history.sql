CREATE OR REPLACE FUNCTION public.delete_admin_tenant(p_tenant_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tenant_row public."tenants"%ROWTYPE;
  preserved_booking_payment_ids integer[] := ARRAY[]::integer[];
  room_capacity integer;
  occupied_beds bigint;
  current_status text;
  tenant_beds bigint;
  booking_beds bigint;
  hold_beds bigint;
BEGIN
  IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;
  IF p_tenant_id IS NULL OR p_tenant_id <= 0 THEN
    RAISE EXCEPTION 'A valid tenant ID is required';
  END IF;

  SELECT t.*
    INTO tenant_row
    FROM public."tenants" AS t
   WHERE t."tenant_id" = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant record not found';
  END IF;

  -- Move-in due dates distinguish the original advance from later extension advances.
  SELECT COALESCE(array_agg(payment."payment_id"), ARRAY[]::integer[])
    INTO preserved_booking_payment_ids
    FROM public."payments" AS payment
    JOIN public."bookings" AS booking
      ON booking."booking_id" = payment."booking_id"
   WHERE payment."tenant_id" = p_tenant_id
     AND payment."payment_type" IN (
       'Initial Booking Payment',
       'Security Deposit',
       'Advance Rent',
       'Advance Rent Applied'
     )
     AND (
       payment."payment_type" IN ('Initial Booking Payment', 'Security Deposit')
       OR payment."due_date" IS NOT DISTINCT FROM booking."move_in_date"
     )
     AND (
       (tenant_row."user_id" IS NOT NULL AND booking."guest_user_id" = tenant_row."user_id")
       OR (
         tenant_row."email" IS NOT NULL
         AND lower(btrim(booking."email")) = lower(btrim(tenant_row."email"))
       )
     );

  UPDATE public."bookings" AS b
     SET "status" = CASE
           WHEN b."status" IN ('Checked In', 'Active') THEN 'Checked Out'
           ELSE 'Cancelled'
         END,
         "checked_out_at" = CASE
           WHEN b."status" IN ('Checked In', 'Active') THEN CURRENT_TIMESTAMP
           ELSE b."checked_out_at"
         END,
         "updated_at" = CURRENT_TIMESTAMP
   WHERE tenant_row."room_id" IS NOT NULL
     AND b."room_id" = tenant_row."room_id"
     AND b."status" IN ('Confirmed', 'Checked In', 'Active')
     AND (
       (tenant_row."user_id" IS NOT NULL AND b."guest_user_id" = tenant_row."user_id")
       OR (
         tenant_row."email" IS NOT NULL
         AND lower(btrim(b."email")) = lower(btrim(tenant_row."email"))
       )
     );

  UPDATE public."payments"
     SET "tenant_id" = NULL
   WHERE "payment_id" = ANY(preserved_booking_payment_ids);

  DELETE FROM public."refund_requests" AS refund
   USING public."payments" AS payment
   WHERE refund."payment_id" = payment."payment_id"
     AND payment."tenant_id" = p_tenant_id;

  DELETE FROM public."full_payment_request_items" AS item
   USING public."payments" AS payment
   WHERE item."payment_id" = payment."payment_id"
     AND payment."tenant_id" = p_tenant_id;

  DELETE FROM public."full_payment_requests"
   WHERE "tenant_id" = p_tenant_id;

  DELETE FROM public."tenants"
   WHERE "tenant_id" = p_tenant_id;

  IF tenant_row."user_id" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."tenants" AS other_tenant
        WHERE other_tenant."user_id" = tenant_row."user_id"
          AND other_tenant."is_active" = 1
          AND other_tenant."deleted_at" IS NULL
     ) THEN
    IF pg_catalog.to_regclass('public.tenant_rating_category_claims') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.tenant_rating_category_claims WHERE user_id = $1'
        USING tenant_row."user_id";
    END IF;

    UPDATE public."users"
       SET "user_type" = 'Guest'
     WHERE "user_id" = tenant_row."user_id"
       AND "user_type" IN ('Tenant', 'Guest');
  END IF;

  IF tenant_row."room_id" IS NOT NULL THEN
    SELECT r."capacity", r."status"
      INTO room_capacity, current_status
      FROM public."rooms" AS r
     WHERE r."room_id" = tenant_row."room_id"
     FOR UPDATE;

    IF FOUND AND current_status <> 'Maintenance' THEN
      SELECT COALESCE(SUM(
               CASE WHEN t."reservation_type" = 'entire_room' THEN room_capacity
                    ELSE LEAST(GREATEST(t."occupant_count", 1), room_capacity) END
             ), 0)::bigint
        INTO tenant_beds
        FROM public."tenants" AS t
       WHERE t."room_id" = tenant_row."room_id"
         AND t."is_active" = 1
         AND t."move_in_date" < CURRENT_DATE + 1
         AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE;

      SELECT COALESCE(SUM(
               CASE WHEN b."reservation_type" = 'entire_room' THEN room_capacity
                    ELSE LEAST(GREATEST(b."occupant_count", 1), room_capacity) END
             ), 0)::bigint
        INTO booking_beds
        FROM public."bookings" AS b
       WHERE b."room_id" = tenant_row."room_id"
         AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
         AND b."move_in_date" < CURRENT_DATE + 1
         AND b."check_out_date" > CURRENT_DATE;

      SELECT COALESCE(SUM(
               CASE WHEN h."reservation_type" = 'entire_room' THEN room_capacity
                    ELSE LEAST(GREATEST(h."occupant_count", 1), room_capacity) END
             ), 0)::bigint
        INTO hold_beds
        FROM public."booking_room_holds" AS h
       WHERE h."room_id" = tenant_row."room_id"
         AND h."expires_at" > CURRENT_TIMESTAMP;

      occupied_beds := COALESCE(tenant_beds, 0) + COALESCE(booking_beds, 0) + COALESCE(hold_beds, 0);

      UPDATE public."rooms"
         SET "status" = CASE
           WHEN room_capacity > 0 AND occupied_beds >= room_capacity THEN 'Occupied'
           WHEN current_status = 'Reserved' THEN 'Reserved'
           ELSE 'Available'
         END
       WHERE "room_id" = tenant_row."room_id";
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_admin_tenant(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_admin_tenant(integer) TO authenticated;
