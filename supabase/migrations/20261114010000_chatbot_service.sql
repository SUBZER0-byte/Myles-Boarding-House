CREATE OR REPLACE FUNCTION public.get_public_chatbot_suggestions()
RETURNS TABLE ("question" varchar(255))
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT s."question"
      FROM public."chatbot_suggested_questions" AS s
     WHERE s."is_active" = 1
       AND btrim(s."question") <> ''
     ORDER BY s."sort_order", s."suggested_question_id"
     LIMIT 10
$$;

REVOKE ALL ON FUNCTION public.get_public_chatbot_suggestions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_chatbot_suggestions() TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public."chatbot_rate_limits" (
    "limit_key" text PRIMARY KEY,
    "window_started_at" timestamp with time zone NOT NULL,
    "request_count" integer NOT NULL CHECK ("request_count" > 0),
    "updated_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public."chatbot_rate_limits" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."chatbot_rate_limits" FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public."chatbot_rate_limits" TO service_role;

CREATE OR REPLACE FUNCTION public.consume_chatbot_rate_limit(
    p_limit_key text,
    p_max_requests integer,
    p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    request_count_value integer;
BEGIN
    IF p_limit_key IS NULL OR p_limit_key !~ '^[0-9a-f]{64}$'
       OR p_max_requests IS NULL OR p_max_requests < 1 OR p_max_requests > 1000
       OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
        RAISE EXCEPTION 'Invalid chatbot rate limit request';
    END IF;

    INSERT INTO public."chatbot_rate_limits" (
        "limit_key", "window_started_at", "request_count", "updated_at"
    )
    VALUES (p_limit_key, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("limit_key") DO UPDATE
       SET "window_started_at" = CASE
               WHEN public."chatbot_rate_limits"."window_started_at"
                    <= CURRENT_TIMESTAMP - make_interval(secs => p_window_seconds)
               THEN CURRENT_TIMESTAMP
               ELSE public."chatbot_rate_limits"."window_started_at"
           END,
           "request_count" = CASE
               WHEN public."chatbot_rate_limits"."window_started_at"
                    <= CURRENT_TIMESTAMP - make_interval(secs => p_window_seconds)
               THEN 1
               ELSE public."chatbot_rate_limits"."request_count" + 1
           END,
           "updated_at" = CURRENT_TIMESTAMP
    RETURNING "request_count" INTO request_count_value;

    RETURN request_count_value <= p_max_requests;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_chatbot_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_chatbot_rate_limit(text, integer, integer) TO service_role;
