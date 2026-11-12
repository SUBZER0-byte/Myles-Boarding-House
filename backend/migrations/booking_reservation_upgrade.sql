-- Additive upgrade for hotel-style boarding-house reservations.
-- Existing bookings and payments are preserved; safe to resume if some columns
-- already exist from an earlier or partial upgrade.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS check_out_date date DEFAULT NULL AFTER move_in_date,
  ADD COLUMN IF NOT EXISTS length_of_stay_months decimal(6,2) NOT NULL DEFAULT 1.00 AFTER check_out_date,
  ADD COLUMN IF NOT EXISTS payment_plan enum('Pay in Full','Pay Monthly','Pay One Month Rent') NOT NULL DEFAULT 'Pay Monthly' AFTER length_of_stay_months,
  ADD COLUMN IF NOT EXISTS total_rent decimal(10,2) NOT NULL DEFAULT 0.00 AFTER payment_plan,
  ADD COLUMN IF NOT EXISTS checked_in_at datetime DEFAULT NULL AFTER total_rent,
  ADD COLUMN IF NOT EXISTS checked_out_at datetime DEFAULT NULL AFTER checked_in_at,
  ADD COLUMN IF NOT EXISTS updated_at datetime DEFAULT NULL AFTER created_at;

ALTER TABLE bookings
  MODIFY COLUMN status enum('Pending','Confirmed','Checked In','Active','Checked Out','Cancelled') NOT NULL DEFAULT 'Pending';

ALTER TABLE payments
  MODIFY COLUMN tenant_id int(11) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS booking_id int(11) DEFAULT NULL AFTER payment_id,
  ADD COLUMN IF NOT EXISTS payment_type varchar(80) DEFAULT NULL AFTER description,
  ADD COLUMN IF NOT EXISTS confirmation_date datetime DEFAULT NULL AFTER submitted_at,
  ADD COLUMN IF NOT EXISTS confirmed_by int(11) DEFAULT NULL AFTER confirmation_date;

ALTER TABLE payments
  MODIFY COLUMN status enum('Pending','Submitted','Confirmed','Paid','Rejected','Overdue','Cancelled') NOT NULL DEFAULT 'Pending';

CREATE TABLE IF NOT EXISTS stay_change_requests (
  request_id int(11) NOT NULL AUTO_INCREMENT,
  booking_id int(11) NOT NULL,
  request_type enum('Extension','Early Checkout') NOT NULL,
  original_check_out_date date NOT NULL,
  requested_check_out_date date NOT NULL,
  status enum('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  applicable_charge decimal(10,2) NOT NULL DEFAULT 0.00,
  refund_amount decimal(10,2) NOT NULL DEFAULT 0.00,
  requested_by int(11) DEFAULT NULL,
  acted_by int(11) DEFAULT NULL,
  acted_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (request_id),
  KEY idx_stay_change_booking (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payments
  ADD KEY IF NOT EXISTS idx_payments_booking (booking_id);