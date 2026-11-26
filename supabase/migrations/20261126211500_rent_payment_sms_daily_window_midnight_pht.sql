BEGIN;

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
               candidate."payment_id",
               candidate."due_date",
               candidate.reminder_type,
               COALESCE(
                   NULLIF(btrim(app_user."phone"), ''),
                   NULLIF(btrim(candidate.tenant_phone), '')
               ) AS recipient_phone
          FROM public."users" AS app_user
          CROSS JOIN local_day
          CROSS JOIN LATERAL (
              SELECT payment."payment_id",
                     payment."due_date",
                     tenant."phone" AS tenant_phone,
                     CASE
                         WHEN payment."due_date" < local_day.reminder_day THEN 'overdue'::text
                         ELSE 'upcoming'::text
                     END AS reminder_type
                FROM public."payments" AS payment
                JOIN public."tenants" AS tenant
                  ON tenant."tenant_id" = payment."tenant_id"
               WHERE tenant."user_id" = app_user."user_id"
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
               LIMIT 1
               FOR UPDATE OF payment SKIP LOCKED
          ) AS candidate
         WHERE app_user."is_active" = 1
           AND app_user."user_type" = 'Tenant'
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
        ON CONFLICT (tenant_user_id, reminder_day) DO NOTHING
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

REVOKE ALL ON FUNCTION public.claim_rent_payment_sms_reminders()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rent_payment_sms_reminders()
    TO service_role;

DO $$
DECLARE
    existing_job record;
BEGIN
    FOR existing_job IN
        SELECT jobid
          FROM cron.job
         WHERE jobname = 'rent-payment-sms-reminders'
    LOOP
        PERFORM cron.unschedule(existing_job.jobid);
    END LOOP;

    PERFORM cron.schedule(
        'rent-payment-sms-reminders',
        '0 16 * * *',
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
                body := '{}'::jsonb,
                timeout_milliseconds := 60000
            );
        $cron$
    );
END;
$$;

COMMIT;
