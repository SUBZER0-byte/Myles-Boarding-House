CREATE OR REPLACE FUNCTION public.claim_rent_payment_sms_reminders()
RETURNS TABLE (
    payment_id integer,
    due_date date,
    recipient_phone text,
    amount numeric,
    description text,
    attempt_count integer
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH eligible AS MATERIALIZED (
        SELECT payment."payment_id",
               payment."due_date",
               COALESCE(NULLIF(btrim(app_user."phone"), ''), NULLIF(btrim(tenant."phone"), '')) AS "recipient_phone"
          FROM public."payments" AS payment
          JOIN public."tenants" AS tenant
            ON tenant."tenant_id" = payment."tenant_id"
          JOIN public."users" AS app_user
            ON app_user."user_id" = tenant."user_id"
         WHERE payment."status" = 'Pending'
           AND payment."due_date" = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date + 5
           AND tenant."is_active" = 1
           AND app_user."is_active" = 1
           AND app_user."user_type" = 'Tenant'
           AND COALESCE(NULLIF(btrim(app_user."phone"), ''), NULLIF(btrim(tenant."phone"), '')) IS NOT NULL
         ORDER BY payment."due_date", payment."payment_id"
         FOR UPDATE OF payment SKIP LOCKED
    ),
    claimed AS (
        INSERT INTO public.rent_payment_sms_reminders AS reminder (
            payment_id, due_date, recipient_phone, status, attempt_count, attempted_at, last_error
        )
        SELECT eligible."payment_id", eligible."due_date", eligible."recipient_phone",
               'sending', 1, now(), NULL
          FROM eligible
        ON CONFLICT (payment_id) DO UPDATE
            SET due_date = EXCLUDED.due_date,
                recipient_phone = EXCLUDED.recipient_phone,
                status = 'sending',
                attempt_count = reminder.attempt_count + 1,
                attempted_at = now(),
                sent_at = NULL,
                last_error = NULL
          WHERE reminder.attempt_count < 4
            AND (
                (reminder.status = 'failed' AND reminder.attempted_at <= now() - interval '15 minutes')
                OR (reminder.status = 'sending' AND reminder.attempted_at <= now() - interval '30 minutes')
            )
        RETURNING reminder.payment_id, reminder.due_date, reminder.recipient_phone, reminder.attempt_count
    )
    SELECT claimed.payment_id,
           claimed.due_date,
           claimed.recipient_phone::text,
           payment."amount",
           payment."description"::text,
           claimed.attempt_count::integer
      FROM claimed
      JOIN public."payments" AS payment
        ON payment."payment_id" = claimed.payment_id
     WHERE payment."status" = 'Pending'
$$;

REVOKE ALL ON FUNCTION public.claim_rent_payment_sms_reminders()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rent_payment_sms_reminders()
    TO service_role;
