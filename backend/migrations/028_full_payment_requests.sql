CREATE TABLE IF NOT EXISTS full_payment_requests (
  request_id INT NOT NULL AUTO_INCREMENT,
  tenant_id INT NOT NULL,
  user_id INT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status ENUM('Requested','Approved','Rejected','Submitted','Confirmed','Cancelled') NOT NULL DEFAULT 'Requested',
  qr_path VARCHAR(255) DEFAULT NULL,
  admin_note TEXT DEFAULT NULL,
  reference_number VARCHAR(120) DEFAULT NULL,
  screenshot_path VARCHAR(255) DEFAULT NULL,
  approved_by INT DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  submitted_at DATETIME DEFAULT NULL,
  confirmed_by INT DEFAULT NULL,
  confirmed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (request_id),
  KEY idx_full_payment_requests_tenant_status (tenant_id, status),
  CONSTRAINT fk_full_payment_requests_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_full_payment_requests_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS full_payment_request_items (
  request_id INT NOT NULL,
  payment_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (request_id, payment_id),
  KEY idx_full_payment_request_items_payment (payment_id),
  CONSTRAINT fk_full_payment_request_items_request
    FOREIGN KEY (request_id) REFERENCES full_payment_requests (request_id) ON DELETE CASCADE,
  CONSTRAINT fk_full_payment_request_items_payment
    FOREIGN KEY (payment_id) REFERENCES payments (payment_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
