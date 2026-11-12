CREATE TABLE IF NOT EXISTS gcash_qr_codes (
  qr_id int(11) NOT NULL AUTO_INCREMENT,
  filename varchar(255) NOT NULL,
  amount decimal(10,2) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (qr_id),
  UNIQUE KEY uq_gcash_qr_filename (filename),
  UNIQUE KEY uq_gcash_qr_amount (amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
