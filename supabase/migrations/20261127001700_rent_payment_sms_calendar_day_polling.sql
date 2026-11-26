BEGIN;

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
                body := '{}'::jsonb,
                timeout_milliseconds := 60000
            );
        $cron$
    );
END;
$$;

COMMIT;
