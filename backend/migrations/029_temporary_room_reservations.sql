ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_expires_at DATETIME DEFAULT NULL AFTER updated_at,
  MODIFY COLUMN status ENUM(
    'Pending',
    'Pending Verification',
    'Confirmed',
    'Checked In',
    'Active',
    'Checked Out',
    'Cancelled',
    'Rejected',
    'Expired'
  ) NOT NULL DEFAULT 'Pending';

ALTER TABLE rooms
  MODIFY COLUMN status ENUM('Available','Reserving','Occupied','Reserved','Maintenance')
  NOT NULL DEFAULT 'Available';

ALTER TABLE booking_initial_payment_requests
  MODIFY COLUMN status ENUM('Checkout','Submitted','Confirmed','Rejected')
  NOT NULL DEFAULT 'Checkout';

UPDATE bookings
SET payment_expires_at = DATE_ADD(created_at, INTERVAL 15 MINUTE)
WHERE status = 'Pending' AND payment_expires_at IS NULL;
