BEGIN;

ALTER TABLE public.rent_payment_sms_reminders
    DROP CONSTRAINT rent_payment_sms_reminders_pkey;
ALTER TABLE public.rent_payment_sms_reminders
    ADD CONSTRAINT rent_payment_sms_reminders_pkey
        PRIMARY KEY (payment_id, reminder_day);

DROP FUNCTION IF EXISTS public.finish_rent_payment_sms_reminder(integer, date, boolean, text);

CREATE OR REPLACE FUNCTION public.claim_rent_payment_sms_reminders()
RETURNS TABLE (
    tenant_user_id integer,
    reminder_day date,
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
    WITH local_day AS MATERIALIZED (
        SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date AS reminder_day
    ),
    eligible AS MATERIALIZED (
        SELECT app_user."user_id" AS tenant_user_id,
               local_day.reminder_day,
               payment."payment_id",
               payment."due_date",
               CASE
                   WHEN payment."due_date" < local_day.reminder_day THEN 'overdue'::text
                   ELSE 'upcoming'::text
               END AS reminder_type,
               COALESCE(
                   NULLIF(btrim(app_user."phone"), ''),
                   NULLIF(btrim(tenant."phone"), '')
               ) AS recipient_phone
          FROM public."users" AS app_user
          JOIN public."tenants" AS tenant
            ON tenant."user_id" = app_user."user_id"
          JOIN public."payments" AS payment
            ON payment."tenant_id" = tenant."tenant_id"
          CROSS JOIN local_day
         WHERE app_user."is_active" = 1
           AND app_user."user_type" = 'Tenant'
           AND tenant."is_active" = 1
           AND (
               (
                   payment."status" = 'Pending'
                   AND payment."due_date"
                       BETWEEN local_day.reminder_day AND local_day.reminder_day + 5
               )
               OR (
                   payment."status" IN ('Pending', 'Overdue')
                   AND payment."due_date" < local_day.reminder_day
               )
           )
           AND COALESCE(
               NULLIF(btrim(app_user."phone"), ''),
               NULLIF(btrim(tenant."phone"), '')
           ) IS NOT NULL
         ORDER BY
               CASE WHEN payment."due_date" < local_day.reminder_day THEN 0 ELSE 1 END,
               payment."due_date",
               payment."payment_id"
         FOR UPDATE OF payment SKIP LOCKED
    ),
    claimed AS (
        INSERT INTO public.rent_payment_sms_reminders AS reminder (
            tenant_user_id,
            reminder_day,
            payment_id,
            due_date,
            reminder_type,
            recipient_phone,
            status,
            attempt_count,
            attempted_at,
            last_error
        )
        SELECT eligible.tenant_user_id,
               eligible.reminder_day,
               eligible."payment_id",
               eligible."due_date",
               eligible.reminder_type,
               eligible.recipient_phone,
               'sending',
               1,
               now(),
               NULL
          FROM eligible
        ON CONFLICT (payment_id, reminder_day) DO NOTHING
        RETURNING
            reminder.tenant_user_id,
            reminder.reminder_day,
            reminder.payment_id,
            reminder.due_date,
            reminder.reminder_type,
            reminder.recipient_phone,
            reminder.attempt_count
    )
    SELECT claimed.tenant_user_id,
           claimed.reminder_day,
           claimed.payment_id,
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

CREATE FUNCTION public.finish_rent_payment_sms_reminder(
    p_tenant_user_id integer,
    p_reminder_day date,
    p_payment_id integer,
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
    IF p_tenant_user_id IS NULL
       OR p_reminder_day IS NULL
       OR p_payment_id IS NULL
       OR p_success IS NULL THEN
        RAISE EXCEPTION 'A tenant user, reminder day, payment, and result are required.';
    END IF;

    UPDATE public.rent_payment_sms_reminders
       SET status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
           sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
           last_error = CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error, 'SMS delivery failed.'), 500) END
     WHERE tenant_user_id = p_tenant_user_id
       AND reminder_day = p_reminder_day
       AND payment_id = p_payment_id
       AND status = 'sending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active daily rent reminder attempt exists for this payment.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rent_payment_sms_reminders()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_rent_payment_sms_reminder(integer, date, integer, boolean, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rent_payment_sms_reminders()
    TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_rent_payment_sms_reminder(integer, date, integer, boolean, text)
    TO service_role;

COMMIT;
