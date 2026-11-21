-- Room capacity is fixed configuration, not remaining inventory.
-- Occupancy is derived from tenant, confirmed booking, and hold records.

DROP TRIGGER IF EXISTS consume_or_restore_tenant_room_capacity ON public."tenants";

DROP FUNCTION IF EXISTS public.consume_or_restore_tenant_room_capacity();

UPDATE public."rooms"
SET "capacity" = "total_capacity"
WHERE "total_capacity" IS NOT NULL;

ALTER TABLE public."rooms"
  DROP COLUMN IF EXISTS "total_capacity";
