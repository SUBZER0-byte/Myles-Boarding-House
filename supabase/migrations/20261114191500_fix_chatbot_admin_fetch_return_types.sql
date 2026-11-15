CREATE OR REPLACE FUNCTION public.get_my_admin_chatbot_faqs()
RETURNS TABLE (
    "faq_id" bigint,
    "category" varchar(32),
    "question" varchar(255),
    "answer" text,
    "is_active" smallint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    RETURN QUERY
    SELECT f."faq_id"::bigint,
           f."category"::varchar(32),
           f."question"::varchar(255),
           f."answer"::text,
           CASE WHEN lower(f."is_active"::text) IN ('1', 'true', 't') THEN 1 ELSE 0 END::smallint
      FROM public."chatbot_faqs" AS f
     ORDER BY f."sort_order", f."faq_id";
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_admin_chatbot_suggested_questions()
RETURNS TABLE (
    "suggested_question_id" bigint,
    "question" varchar(255),
    "is_active" smallint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    RETURN QUERY
    SELECT s."suggested_question_id"::bigint,
           s."question"::varchar(255),
           CASE WHEN lower(s."is_active"::text) IN ('1', 'true', 't') THEN 1 ELSE 0 END::smallint
      FROM public."chatbot_suggested_questions" AS s
     ORDER BY s."sort_order", s."suggested_question_id";
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_chatbot_faqs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_admin_chatbot_suggested_questions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_chatbot_faqs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_admin_chatbot_suggested_questions() TO authenticated;
