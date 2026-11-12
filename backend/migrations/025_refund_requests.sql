CREATE TABLE IF NOT EXISTS refund_requests (
  refund_id INT NOT NULL AUTO_INCREMENT,
  payment_id INT NOT NULL,
  user_id INT NOT NULL,
  refund_amount DECIMAL(10,2) NOT NULL,
  transaction_reference VARCHAR(120) DEFAULT NULL,
  screenshot_path VARCHAR(255) DEFAULT NULL,
  reason TEXT DEFAULT NULL,
  status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  admin_note TEXT DEFAULT NULL,
  acted_by INT DEFAULT NULL,
  acted_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (refund_id),
  KEY idx_refund_requests_payment_status (payment_id, status),
  KEY idx_refund_requests_user (user_id, created_at),
  CONSTRAINT fk_refund_requests_payment
    FOREIGN KEY (payment_id) REFERENCES payments (payment_id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_requests_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
