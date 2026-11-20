ALTER TABLE public."bookings"
    ALTER COLUMN "payment_expires_at" TYPE timestamp with time zone
    USING "payment_expires_at" AT TIME ZONE 'Asia/Manila';

COMMENT ON COLUMN public."bookings"."payment_expires_at" IS
    'Absolute payment deadline instant; display in Asia/Manila for the booking flow.';
