ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reservation_type ENUM('capacity_based','entire_room')
    NOT NULL DEFAULT 'capacity_based' AFTER room_id,
  ADD COLUMN IF NOT EXISTS occupant_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER reservation_type;

ALTER TABLE booking_room_holds
  ADD COLUMN IF NOT EXISTS move_in_date DATE DEFAULT NULL AFTER room_id,
  ADD COLUMN IF NOT EXISTS check_out_date DATE DEFAULT NULL AFTER move_in_date,
  ADD COLUMN IF NOT EXISTS reservation_type ENUM('capacity_based','entire_room')
    NOT NULL DEFAULT 'capacity_based' AFTER check_out_date,
  ADD COLUMN IF NOT EXISTS occupant_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER reservation_type,
  ADD KEY IF NOT EXISTS idx_booking_room_holds_dates
    (room_id, move_in_date, check_out_date, expires_at);

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS reservation_type ENUM('capacity_based','entire_room')
    NOT NULL DEFAULT 'capacity_based' AFTER room_id,
  ADD COLUMN IF NOT EXISTS occupant_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER reservation_type;
