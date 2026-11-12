-- Persist capture/refund state before making PayPal API calls so uncertain
-- outcomes can be reconciled without releasing the room hold.
ALTER TABLE booking_initial_payment_requests
  MODIFY COLUMN status ENUM(
    'Checkout',
    'Submitted',
    'Confirmed',
    'Rejected',
    'Capturing',
    'Refund Pending',
    'Refund Processing',
    'Refunded',
    'Reconciliation Required',
    'Closed'
  ) NOT NULL DEFAULT 'Checkout',
  ADD COLUMN IF NOT EXISTS paypal_order_history LONGTEXT DEFAULT NULL AFTER paypal_order_id,
  ADD COLUMN IF NOT EXISTS paypal_capture_request_id CHAR(32) DEFAULT NULL AFTER paypal_capture_id,
  ADD COLUMN IF NOT EXISTS paypal_capture_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER paypal_capture_request_id,
  ADD COLUMN IF NOT EXISTS paypal_refund_id VARCHAR(40) DEFAULT NULL AFTER paypal_capture_attempts,
  ADD COLUMN IF NOT EXISTS paypal_refund_request_id CHAR(32) DEFAULT NULL AFTER paypal_refund_id,
  ADD COLUMN IF NOT EXISTS paypal_refund_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER paypal_refund_request_id,
  ADD COLUMN IF NOT EXISTS paypal_retry_at DATETIME DEFAULT NULL AFTER paypal_refund_attempts,
  ADD COLUMN IF NOT EXISTS paypal_processing_lease_until DATETIME DEFAULT NULL AFTER paypal_retry_at,
  ADD COLUMN IF NOT EXISTS paypal_last_error TEXT DEFAULT NULL AFTER paypal_processing_lease_until,
  ADD INDEX IF NOT EXISTS idx_booking_paypal_reconciliation
    (method, status, paypal_retry_at, paypal_processing_lease_until);
