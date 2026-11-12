ALTER TABLE bookings
  ADD KEY IF NOT EXISTS idx_bookings_room_dates (room_id, status, move_in_date, check_out_date);

ALTER TABLE tenants
  ADD KEY IF NOT EXISTS idx_tenants_room_dates (room_id, is_active, move_in_date, move_out_date);
