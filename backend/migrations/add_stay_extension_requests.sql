-- Adds storage for tenant-requested checkout date extensions.
-- Safe to run if the table was already created by booking_reservation_upgrade.sql.

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
