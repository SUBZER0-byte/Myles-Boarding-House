ALTER TABLE public."rooms"
  ADD COLUMN IF NOT EXISTS "total_capacity" integer;

UPDATE public."rooms"
SET "total_capacity" = COALESCE("total_capacity", "capacity")
WHERE "total_capacity" IS NULL;

ALTER TABLE public."rooms"
  ALTER COLUMN "total_capacity" SET NOT NULL;

CREATE OR REPLACE FUNCTION public.consume_or_restore_tenant_room_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_room_id integer;
  old_room_id integer;
  base_capacity integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_room_id := OLD."room_id";
    IF old_room_id IS NULL THEN
      RETURN OLD;
    END IF;

    SELECT COALESCE(r."total_capacity", r."capacity")
      INTO base_capacity
      FROM public."rooms" r
     WHERE r."room_id" = old_room_id;

    UPDATE public."rooms"
       SET "capacity" = LEAST(GREATEST("capacity" + 1, 0), base_capacity)
     WHERE "room_id" = old_room_id
       AND "status" <> 'Maintenance';

    RETURN OLD;
  END IF;

  new_room_id := NEW."room_id";
  IF new_room_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."room_id" IS NOT NULL
     AND OLD."room_id" IS DISTINCT FROM NEW."room_id" THEN
    old_room_id := OLD."room_id";
    SELECT COALESCE(r."total_capacity", r."capacity")
      INTO base_capacity
      FROM public."rooms" r
     WHERE r."room_id" = old_room_id;
    UPDATE public."rooms"
       SET "capacity" = LEAST(GREATEST("capacity" + 1, 0), base_capacity)
     WHERE "room_id" = old_room_id
       AND "status" <> 'Maintenance';
  END IF;

  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND OLD."room_id" IS DISTINCT FROM NEW."room_id") THEN
    SELECT COALESCE(r."total_capacity", r."capacity")
      INTO base_capacity
      FROM public."rooms" r
     WHERE r."room_id" = new_room_id;
    UPDATE public."rooms"
       SET "capacity" = GREATEST("capacity" - 1, 0)
     WHERE "room_id" = new_room_id
       AND "status" <> 'Maintenance';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consume_or_restore_tenant_room_capacity ON public."tenants";
CREATE TRIGGER consume_or_restore_tenant_room_capacity
AFTER INSERT OR UPDATE OR DELETE ON public."tenants"
FOR EACH ROW
EXECUTE FUNCTION public.consume_or_restore_tenant_room_capacity();
