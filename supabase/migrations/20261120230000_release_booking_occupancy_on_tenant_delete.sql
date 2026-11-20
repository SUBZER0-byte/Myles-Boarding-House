CREATE OR REPLACE FUNCTION public.release_tenant_booking_occupancy_on_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public."bookings" AS b
       SET "status" = CASE
               WHEN b."status" = 'Confirmed' THEN 'Cancelled'
               ELSE 'Checked Out'
           END,
           "checked_out_at" = CASE
               WHEN b."status" IN ('Checked In', 'Active') THEN CURRENT_TIMESTAMP
               ELSE b."checked_out_at"
           END,
           "updated_at" = CURRENT_TIMESTAMP
     WHERE b."room_id" = NEW."room_id"
       AND b."status" IN ('Confirmed', 'Checked In', 'Active')
       AND b."move_in_date" IS NOT DISTINCT FROM NEW."move_in_date"
       AND b."check_out_date" IS NOT DISTINCT FROM NEW."move_out_date"
       AND (
           (NEW."user_id" IS NOT NULL AND b."guest_user_id" = NEW."user_id")
           OR (
               NEW."email" IS NOT NULL
               AND lower(btrim(b."email")) = lower(btrim(NEW."email"))
           )
       );

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.release_tenant_booking_occupancy_on_archive() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tenants_release_booking_occupancy_on_archive ON public."tenants";
CREATE TRIGGER tenants_release_booking_occupancy_on_archive
    AFTER UPDATE OF "deleted_at" ON public."tenants"
    FOR EACH ROW
    WHEN (OLD."deleted_at" IS NULL AND NEW."deleted_at" IS NOT NULL)
    EXECUTE FUNCTION public.release_tenant_booking_occupancy_on_archive();
