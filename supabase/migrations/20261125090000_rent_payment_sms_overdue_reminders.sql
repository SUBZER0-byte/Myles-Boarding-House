ALTER TABLE public.rent_payment_sms_reminders
    ADD COLUMN reminder_type text NOT NULL DEFAULT 'upcoming'
        CHECK (reminder_type IN ('upcoming', 'overdue'));

ALTER TABLE public.rent_payment_sms_reminders
    DROP CONSTRAINT IF EXISTS rent_payment_sms_reminders_pkey;

ALTER TABLE public.rent_payment_sms_reminders
    ADD CONSTRAINT rent_payment_sms_reminders_pkey
        PRIMARY KEY (payment_id, due_date, reminder_type);

DROP FUNCTION IF EXISTS public.claim_rent_payment_sms_reminders();

CREATE FUNCTION public.claim_rent_payment_sms_reminders()
RETURNS TABLE (
    payment_id integer,
    due_date date,
    reminder_type text,
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
               reminder_window."reminder_type",
               COALESCE(NULLIF(btrim(app_user."phone"), ''), NULLIF(btrim(tenant."phone"), '')) AS "recipient_phone"
          FROM public."payments" AS payment
          JOIN public."tenants" AS tenant
            ON tenant."tenant_id" = payment."tenant_id"
          JOIN public."users" AS app_user
            ON app_user."user_id" = tenant."user_id"
          CROSS JOIN LATERAL (
              VALUES
                  (
                      'upcoming'::text,
                      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date + 5
                  ),
                  (
                      'overdue'::text,
                      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date - 1
                  )
          ) AS reminder_window("reminder_type", "reminder_date")
         WHERE payment."status" IN ('Pending', 'Overdue')
           AND payment."due_date" = reminder_window."reminder_date"
           AND tenant."is_active" = 1
           AND app_user."is_active" = 1
           AND app_user."user_type" = 'Tenant'
           AND COALESCE(NULLIF(btrim(app_user."phone"), ''), NULLIF(btrim(tenant."phone"), '')) IS NOT NULL
         ORDER BY payment."due_date", payment."payment_id", reminder_window."reminder_type"
         FOR UPDATE OF payment SKIP LOCKED
    ),
    claimed AS (
        INSERT INTO public.rent_payment_sms_reminders AS reminder (
            payment_id, due_date, reminder_type, recipient_phone, status, attempt_count, attempted_at, last_error
        )
        SELECT eligible."payment_id", eligible."due_date", eligible."reminder_type",
               eligible."recipient_phone", 'sending', 1, now(), NULL
          FROM eligible
        ON CONFLICT (payment_id, due_date, reminder_type) DO UPDATE
            SET recipient_phone = EXCLUDED.recipient_phone,
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
        RETURNING
            reminder.payment_id,
            reminder.due_date,
            reminder.reminder_type,
            reminder.recipient_phone,
            reminder.attempt_count
    )
    SELECT claimed.payment_id,
           claimed.due_date,
           claimed.reminder_type,
           claimed.recipient_phone::text,
           payment."amount",
           payment."description"::text,
           claimed.attempt_count::integer
      FROM claimed
      JOIN public."payments" AS payment
        ON payment."payment_id" = claimed.payment_id
     WHERE payment."status" IN ('Pending', 'Overdue')
$$;

DROP FUNCTION IF EXISTS public.finish_rent_payment_sms_reminder(integer, boolean, text);

CREATE FUNCTION public.finish_rent_payment_sms_reminder(
    p_payment_id integer,
    p_due_date date,
    p_reminder_type text,
    p_success boolean,
    p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_payment_id IS NULL
       OR p_due_date IS NULL
       OR p_reminder_type IS NULL
       OR p_reminder_type NOT IN ('upcoming', 'overdue')
       OR p_success IS NULL THEN
        RAISE EXCEPTION 'A payment, due date, reminder type, and result are required.';
    END IF;

    UPDATE public.rent_payment_sms_reminders
       SET status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
           sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
           last_error = CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error, 'SMS delivery failed.'), 500) END
     WHERE payment_id = p_payment_id
       AND due_date = p_due_date
       AND reminder_type = p_reminder_type
       AND status = 'sending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active rent reminder attempt exists for this payment.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rent_payment_sms_reminders()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_rent_payment_sms_reminder(integer, date, text, boolean, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rent_payment_sms_reminders()
    TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_rent_payment_sms_reminder(integer, date, text, boolean, text)
    TO service_role;
