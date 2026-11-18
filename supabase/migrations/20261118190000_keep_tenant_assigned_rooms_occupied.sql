CREATE OR REPLACE FUNCTION public.keep_tenant_assigned_room_occupied()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW."status" <> 'Maintenance'
       AND EXISTS (
           SELECT 1
             FROM public."tenants" AS t
            WHERE t."room_id" = NEW."room_id"
              AND t."is_active" = 1
              AND t."deleted_at" IS NULL
              AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
       ) THEN
        NEW."status" := 'Occupied';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_keep_tenant_assigned_occupied ON public."rooms";
CREATE TRIGGER rooms_keep_tenant_assigned_occupied
    BEFORE UPDATE OF "status" ON public."rooms"
    FOR EACH ROW
    EXECUTE FUNCTION public.keep_tenant_assigned_room_occupied();
