ALTER TABLE refund_requests
  ADD COLUMN IF NOT EXISTS gcash_account_name VARCHAR(120) NOT NULL DEFAULT '' AFTER refund_amount,
  ADD COLUMN IF NOT EXISTS gcash_number VARCHAR(30) NOT NULL DEFAULT '' AFTER gcash_account_name;
