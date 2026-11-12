ALTER TABLE refund_requests
  ADD COLUMN IF NOT EXISTS transfer_reference VARCHAR(120) DEFAULT NULL AFTER screenshot_path,
  ADD COLUMN IF NOT EXISTS transfer_screenshot_path VARCHAR(255) DEFAULT NULL AFTER transfer_reference;

INSERT IGNORE INTO gcash_transaction_references (reference_number)
SELECT transaction_reference FROM refund_requests
WHERE transaction_reference IS NOT NULL AND TRIM(transaction_reference) <> ''
UNION
SELECT transfer_reference FROM refund_requests
WHERE transfer_reference IS NOT NULL AND TRIM(transfer_reference) <> '';
