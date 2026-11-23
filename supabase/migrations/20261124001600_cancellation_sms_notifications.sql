CREATE TABLE IF NOT EXISTS public.cancellation_sms_notification_events (
    cancellation_id integer NOT NULL
        REFERENCES public."cancellation_requests" ("cancellation_id") ON DELETE CASCADE,
    event_type text NOT NULL
        CHECK (event_type IN (
            'cancellation_submitted',
            'cancellation_approved',
            'cancellation_rejected'
        )),
    status text NOT NULL DEFAULT 'sending'
        CHECK (status IN ('sending', 'sent', 'partial', 'failed')),
    attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
    sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
    failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    last_error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cancellation_id, event_type)
);

ALTER TABLE public.cancellation_sms_notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cancellation_sms_notification_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cancellation_sms_notification_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_cancellation_sms_notification(
    p_cancellation_id integer,
    p_event_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    claimed boolean;
BEGIN
    IF p_cancellation_id IS NULL
       OR p_cancellation_id <= 0
       OR p_event_type IS NULL
       OR p_event_type NOT IN (
           'cancellation_submitted',
           'cancellation_approved',
           'cancellation_rejected'
       ) THEN
        RAISE EXCEPTION 'Invalid cancellation SMS notification request';
    END IF;

    WITH claim AS (
        INSERT INTO public.cancellation_sms_notification_events (
            cancellation_id, event_type, status, attempt_count, updated_at
        ) VALUES (
            p_cancellation_id, p_event_type, 'sending', 1, CURRENT_TIMESTAMP
        )
        ON CONFLICT (cancellation_id, event_type) DO UPDATE
           SET status = 'sending',
               attempt_count = public.cancellation_sms_notification_events.attempt_count + 1,
               sent_count = 0,
               failed_count = 0,
               last_error = NULL,
               sent_at = NULL,
               updated_at = CURRENT_TIMESTAMP
         WHERE (
                public.cancellation_sms_notification_events.status = 'failed'
                AND public.cancellation_sms_notification_events.attempt_count < 3
                AND public.cancellation_sms_notification_events.updated_at
                    < CURRENT_TIMESTAMP - interval '1 minute'
            )
            OR (
                public.cancellation_sms_notification_events.status = 'sending'
                AND public.cancellation_sms_notification_events.attempt_count < 3
                AND public.cancellation_sms_notification_events.updated_at
                    < CURRENT_TIMESTAMP - interval '10 minutes'
            )
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM claim) INTO claimed;

    RETURN claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_cancellation_sms_notification(
    p_cancellation_id integer,
    p_event_type text,
    p_status text,
    p_sent_count integer,
    p_failed_count integer,
    p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_cancellation_id IS NULL
       OR p_cancellation_id <= 0
       OR p_event_type IS NULL
       OR p_event_type NOT IN (
           'cancellation_submitted',
           'cancellation_approved',
           'cancellation_rejected'
       )
       OR p_status IS NULL
       OR p_status NOT IN ('sent', 'partial', 'failed')
       OR p_sent_count IS NULL
       OR p_sent_count < 0
       OR p_failed_count IS NULL
       OR p_failed_count < 0 THEN
        RAISE EXCEPTION 'Invalid cancellation SMS notification result';
    END IF;

    UPDATE public.cancellation_sms_notification_events
       SET status = p_status,
           sent_count = p_sent_count,
           failed_count = p_failed_count,
           last_error = CASE WHEN p_status = 'sent' THEN NULL ELSE left(p_error, 500) END,
           sent_at = CASE WHEN p_sent_count > 0 THEN CURRENT_TIMESTAMP ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
     WHERE cancellation_id = p_cancellation_id
       AND event_type = p_event_type
       AND status = 'sending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cancellation SMS notification claim was not found';
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_cancellation_sms_notification(integer, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cancellation_sms_notification(integer, text)
    TO service_role;
REVOKE ALL ON FUNCTION public.finish_cancellation_sms_notification(integer, text, text, integer, integer, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_cancellation_sms_notification(integer, text, text, integer, integer, text)
    TO service_role;
