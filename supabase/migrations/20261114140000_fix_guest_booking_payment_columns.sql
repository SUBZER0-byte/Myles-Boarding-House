ALTER TABLE public."booking_initial_payment_requests"
    ADD COLUMN IF NOT EXISTS "screenshot_path" varchar(255),
    ADD COLUMN IF NOT EXISTS "submitted_at" timestamp without time zone;

UPDATE public."booking_initial_payment_requests" AS request
   SET "screenshot_path" = COALESCE(
           request."screenshot_path",
           (
               SELECT proof."screenshot_path"
                 FROM public."payments" AS payment
                 JOIN public."payment_proofs" AS proof
                   ON proof."payment_id" = payment."payment_id"
                WHERE payment."booking_id" = request."booking_id"
                  AND payment."payment_type" = 'Initial Booking Payment'
                  AND (
                      request."submission_key" IS NULL
                      OR payment."idempotency_key" = request."submission_key"
                  )
                ORDER BY payment."created_at" DESC, payment."payment_id" DESC
                LIMIT 1
           )
       ),
       "submitted_at" = COALESCE(
           request."submitted_at",
           (
               SELECT payment."submitted_at"
                 FROM public."payments" AS payment
                WHERE payment."booking_id" = request."booking_id"
                  AND payment."payment_type" = 'Initial Booking Payment'
                  AND (
                      request."submission_key" IS NULL
                      OR payment."idempotency_key" = request."submission_key"
                  )
                ORDER BY payment."created_at" DESC, payment."payment_id" DESC
                LIMIT 1
           )
       )
 WHERE request."screenshot_path" IS NULL
    OR request."submitted_at" IS NULL;
