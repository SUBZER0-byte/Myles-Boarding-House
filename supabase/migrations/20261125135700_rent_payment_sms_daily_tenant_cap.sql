BEGIN;

DROP FUNCTION IF EXISTS public.claim_rent_payment_sms_reminders();
DROP FUNCTION IF EXISTS public.finish_rent_payment_sms_reminder(integer, boolean, text);
DROP FUNCTION IF EXISTS public.finish_rent_payment_sms_reminder(integer, date, text, boolean, text);

ALTER TABLE public.rent_payment_sms_reminders
    RENAME TO rent_payment_sms_reminders_history;
ALTER TABLE public.rent_payment_sms_reminders_history
    RENAME CONSTRAINT rent_payment_sms_reminders_pkey
    TO rent_payment_sms_reminders_history_pkey;

CREATE TABLE public.rent_payment_sms_reminders (
    tenant_user_id integer NOT NULL
        REFERENCES public."users" ("user_id") ON DELETE CASCADE,
    reminder_day date NOT NULL,
    payment_id integer NOT NULL,
    due_date date NOT NULL,
    reminder_type text NOT NULL
        CHECK (reminder_type IN ('upcoming', 'overdue')),
    recipient_phone varchar(40) NOT NULL,
    status text NOT NULL
        CHECK (status IN ('sending', 'sent', 'failed')),
    attempt_count smallint NOT NULL DEFAULT 1
        CHECK (attempt_count BETWEEN 1 AND 4),
    attempted_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    last_error text,
    CONSTRAINT rent_payment_sms_reminders_pkey
        PRIMARY KEY (tenant_user_id, reminder_day)
);

ALTER TABLE public.rent_payment_sms_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rent_payment_sms_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rent_payment_sms_reminders TO service_role;

CREATE INDEX rent_payment_sms_reminders_payment_id_idx
    ON public.rent_payment_sms_reminders (payment_id);

WITH previous_attempts AS (
    SELECT tenant."user_id" AS tenant_user_id,
           (history."attempted_at" AT TIME ZONE 'Asia/Manila')::date AS reminder_day,
           history."payment_id",
           history."due_date",
           CASE
               WHEN history."due_date" < (history."attempted_at" AT TIME ZONE 'Asia/Manila')::date
                   THEN 'overdue'
               ELSE 'upcoming'
           END AS reminder_type,
           history."recipient_phone",
           history."status",
           history."attempt_count",
           history."attempted_at",
           history."sent_at",
           history."last_error",
           row_number() OVER (
               PARTITION BY tenant."user_id",
                            (history."attempted_at" AT TIME ZONE 'Asia/Manila')::date
               ORDER BY
                   CASE WHEN history."status" = 'sent' THEN 0 ELSE 1 END,
                   CASE
                       WHEN history."due_date" < (history."attempted_at" AT TIME ZONE 'Asia/Manila')::date
                           THEN 0
                       ELSE 1
                   END,
                   history."attempted_at",
                   history."payment_id"
           ) AS daily_rank
      FROM public.rent_payment_sms_reminders_history AS history
      JOIN public."payments" AS payment
        ON payment."payment_id" = history."payment_id"
      JOIN public."tenants" AS tenant
        ON tenant."tenant_id" = payment."tenant_id"
)
INSERT INTO public.rent_payment_sms_reminders (
    tenant_user_id,
    reminder_day,
    payment_id,
    due_date,
    reminder_type,
    recipient_phone,
    status,
    attempt_count,
    attempted_at,
    sent_at,
    last_error
)
SELECT tenant_user_id,
       reminder_day,
       payment_id,
       due_date,
       reminder_type,
       recipient_phone,
       status,
       attempt_count,
       attempted_at,
       sent_at,
       last_error
  FROM previous_attempts
 WHERE daily_rank = 1;

CREATE FUNCTION public.claim_rent_payment_sms_reminders()
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
                         AND payment."due_date" = local_day.reminder_day + 5
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

CREATE FUNCTION public.finish_rent_payment_sms_reminder(
    p_tenant_user_id integer,
    p_reminder_day date,
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
    IF p_tenant_user_id IS NULL OR p_reminder_day IS NULL OR p_success IS NULL THEN
        RAISE EXCEPTION 'A tenant user, reminder day, and result are required.';
    END IF;

    UPDATE public.rent_payment_sms_reminders
       SET status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
           sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
           last_error = CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error, 'SMS delivery failed.'), 500) END
     WHERE tenant_user_id = p_tenant_user_id
       AND reminder_day = p_reminder_day
       AND status = 'sending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active daily rent reminder attempt exists for this tenant.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rent_payment_sms_reminders()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_rent_payment_sms_reminder(integer, date, boolean, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rent_payment_sms_reminders()
    TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_rent_payment_sms_reminder(integer, date, boolean, text)
    TO service_role;

COMMIT;
