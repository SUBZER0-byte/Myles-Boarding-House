-- Keep checkout and GCash review details separate from confirmed payment records.
CREATE TABLE IF NOT EXISTS booking_initial_payment_requests (
  booking_id INT NOT NULL,
  method ENUM('GCash','PayPal') NOT NULL,
  status ENUM('Checkout','Submitted','Confirmed') NOT NULL DEFAULT 'Checkout',
  amount DECIMAL(10,2) NOT NULL,
  reference_number VARCHAR(120) DEFAULT NULL,
  paypal_order_id VARCHAR(40) DEFAULT NULL,
  paypal_capture_id VARCHAR(40) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_id),
  UNIQUE KEY uq_booking_initial_payment_order (paypal_order_id),
  UNIQUE KEY uq_booking_initial_payment_capture (paypal_capture_id),
  CONSTRAINT fk_booking_initial_payment_request_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (booking_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
