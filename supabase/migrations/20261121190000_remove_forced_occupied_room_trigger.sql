DROP TRIGGER IF EXISTS rooms_keep_tenant_assigned_occupied ON public."rooms";

DROP FUNCTION IF EXISTS public.keep_tenant_assigned_room_occupied();
