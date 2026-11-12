CREATE TABLE IF NOT EXISTS gcash_transaction_references (
  reference_number VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reference_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO gcash_transaction_references (reference_number)
SELECT reference_number FROM payments
WHERE reference_number IS NOT NULL AND TRIM(reference_number) <> ''
UNION
SELECT reference_number FROM booking_initial_payment_requests
WHERE reference_number IS NOT NULL AND TRIM(reference_number) <> ''
UNION
SELECT reference_number FROM full_payment_requests
WHERE reference_number IS NOT NULL AND TRIM(reference_number) <> '';
