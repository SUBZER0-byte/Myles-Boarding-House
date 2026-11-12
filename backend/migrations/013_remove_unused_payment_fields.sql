-- Remove database fields and tables that are not used by the application.
-- These fields were verified empty in the live database before removal.

ALTER TABLE maintenance_requests
  DROP COLUMN IF EXISTS assigned_to;

ALTER TABLE payments
  DROP COLUMN IF EXISTS paypal_payer_email,
  DROP COLUMN IF EXISTS gateway_amount,
  DROP COLUMN IF EXISTS payment_transaction_id;

DROP TABLE IF EXISTS payment_transactions;
DROP TABLE IF EXISTS paypal_webhook_events;
