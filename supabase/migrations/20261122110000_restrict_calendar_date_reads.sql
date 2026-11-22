DROP POLICY IF EXISTS "authenticated_can_read_active_tenant_move_in_dates"
ON public."tenants";

DROP POLICY IF EXISTS "authenticated_can_read_pending_booking_move_in_dates"
ON public."bookings";
