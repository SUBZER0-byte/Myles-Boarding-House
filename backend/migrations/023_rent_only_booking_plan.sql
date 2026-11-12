ALTER TABLE bookings
  MODIFY COLUMN payment_plan enum('Pay in Full','Pay Monthly','Pay One Month Rent')
  NOT NULL DEFAULT 'Pay Monthly';
