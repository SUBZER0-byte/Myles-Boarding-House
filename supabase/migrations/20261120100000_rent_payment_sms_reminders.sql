CREATE INDEX IF NOT EXISTS payments_pending_due_date_sms_idx
    ON public."payments" ("due_date", "tenant_id")
    WHERE "status" = 'Pending';

CREATE TABLE IF NOT EXISTS public.rent_payment_sms_reminders (
    payment_id integer PRIMARY KEY
        REFERENCES public."payments" ("payment_id") ON DELETE CASCADE,
    due_date date NOT NULL,
    recipient_phone varchar(40) NOT NULL,
    status text NOT NULL DEFAULT 'sending'
        CHECK (status IN ('sending', 'sent', 'failed')),
    attempt_count smallint NOT NULL DEFAULT 1
        CHECK (attempt_count BETWEEN 1 AND 4),
    attempted_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    last_error text
);

ALTER TABLE public.rent_payment_sms_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rent_payment_sms_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rent_payment_sms_reminders TO service_role;

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
               COALESCE(NULLIF(btrim(tenant."phone"), ''), NULLIF(btrim(app_user."phone"), '')) AS "recipient_phone"
          FROM public."payments" AS payment
          JOIN public."tenants" AS tenant
            ON tenant."tenant_id" = payment."tenant_id"
          JOIN public."users" AS app_user
            ON app_user."user_id" = tenant."user_id"
         WHERE payment."status" = 'Pending'
           AND payment."due_date" = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date + 3
           AND tenant."is_active" = 1
           AND app_user."is_active" = 1
           AND app_user."user_type" = 'Tenant'
           AND COALESCE(NULLIF(btrim(tenant."phone"), ''), NULLIF(btrim(app_user."phone"), '')) IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.finish_rent_payment_sms_reminder(
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
    IF p_payment_id IS NULL OR p_success IS NULL THEN
        RAISE EXCEPTION 'A payment ID and reminder result are required.';
    END IF;

    UPDATE public.rent_payment_sms_reminders
       SET status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
           sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
           last_error = CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error, 'SMS delivery failed.'), 500) END
     WHERE payment_id = p_payment_id
       AND status = 'sending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active rent reminder attempt exists for this payment.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rent_payment_sms_reminders()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_rent_payment_sms_reminder(integer, boolean, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rent_payment_sms_reminders()
    TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_rent_payment_sms_reminder(integer, boolean, text)
    TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
    existing_job record;
BEGIN
    FOR existing_job IN
        SELECT jobid FROM cron.job WHERE jobname = 'rent-payment-sms-reminders'
    LOOP
        PERFORM cron.unschedule(existing_job.jobid);
    END LOOP;

    PERFORM cron.schedule(
        'rent-payment-sms-reminders',
        '*/15 * * * *',
        $cron$
            SELECT net.http_post(
                url := (
                    SELECT decrypted_secret
                      FROM vault.decrypted_secrets
                     WHERE name = 'rent_payment_reminder_project_url'
                ) || '/functions/v1/rent-payment-reminders',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'apikey', (
                        SELECT decrypted_secret
                          FROM vault.decrypted_secrets
                         WHERE name = 'rent_payment_reminder_anon_key'
                    ),
                    'x-cron-secret', (
                        SELECT decrypted_secret
                          FROM vault.decrypted_secrets
                         WHERE name = 'rent_payment_reminder_cron_secret'
                    )
                ),
                body := '{}'::jsonb
            );
        $cron$
    );
END;
$$;
