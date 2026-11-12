-- 010_paypal_payment_transactions.sql
-- Add the PayPal fields currently used by the payment flow.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_type VARCHAR(80) DEFAULT NULL AFTER description,
  ADD COLUMN IF NOT EXISTS gateway VARCHAR(20) NOT NULL DEFAULT 'paypal' AFTER method,
  ADD COLUMN IF NOT EXISTS paypal_order_id VARCHAR(40) NULL AFTER reference_number,
  ADD COLUMN IF NOT EXISTS paypal_capture_id VARCHAR(40) NULL AFTER paypal_order_id;

ALTER TABLE payments
  ADD INDEX IF NOT EXISTS idx_payments_gateway_order (paypal_order_id);
