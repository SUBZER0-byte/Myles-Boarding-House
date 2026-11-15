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
    SELECT f."faq_id", f."category", f."question", f."answer", f."is_active"
      FROM public."chatbot_faqs" AS f
     ORDER BY f."sort_order", f."faq_id";
END;
$$;

CREATE OR REPLACE FUNCTION public.save_my_admin_chatbot_faq(
    p_faq_id bigint,
    p_category text,
    p_question text,
    p_answer text,
    p_is_active boolean
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    faq_id_value bigint;
    category_value text := btrim(COALESCE(p_category, ''));
    question_value text := btrim(COALESCE(p_question, ''));
    answer_value text := btrim(COALESCE(p_answer, ''));
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF category_value NOT IN (
        'rates', 'availability', 'house_rules', 'payment_methods',
        'reservation_steps', 'location', 'other'
    ) THEN
        RAISE EXCEPTION 'Unsupported chatbot FAQ category';
    END IF;
    IF question_value = '' OR length(question_value) > 255
       OR answer_value = '' OR length(answer_value) > 5000
       OR p_is_active IS NULL THEN
        RAISE EXCEPTION 'Chatbot FAQ fields are invalid';
    END IF;

    IF p_faq_id IS NULL THEN
        INSERT INTO public."chatbot_faqs" (
            "category", "question", "answer", "is_active"
        )
        VALUES (
            category_value, question_value, answer_value,
            CASE WHEN p_is_active THEN 1 ELSE 0 END
        )
        RETURNING "faq_id" INTO faq_id_value;
    ELSE
        UPDATE public."chatbot_faqs"
           SET "category" = category_value,
               "question" = question_value,
               "answer" = answer_value,
               "is_active" = CASE WHEN p_is_active THEN 1 ELSE 0 END
         WHERE "faq_id" = p_faq_id
        RETURNING "faq_id" INTO faq_id_value;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Chatbot FAQ was not found';
        END IF;
    END IF;

    RETURN faq_id_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_admin_chatbot_faq(p_faq_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_faq_id IS NULL OR p_faq_id < 1 THEN
        RAISE EXCEPTION 'Chatbot FAQ identifier is invalid';
    END IF;
    DELETE FROM public."chatbot_faqs" WHERE "faq_id" = p_faq_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Chatbot FAQ was not found';
    END IF;
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
    SELECT s."suggested_question_id", s."question", s."is_active"
      FROM public."chatbot_suggested_questions" AS s
     ORDER BY s."sort_order", s."suggested_question_id";
END;
$$;

CREATE OR REPLACE FUNCTION public.save_my_admin_chatbot_suggested_question(
    p_suggested_question_id bigint,
    p_question text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    question_value text := btrim(COALESCE(p_question, ''));
    question_id_value bigint;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF question_value = '' OR length(question_value) > 255 THEN
        RAISE EXCEPTION 'Suggested question must be between 1 and 255 characters';
    END IF;

    IF p_suggested_question_id IS NULL THEN
        INSERT INTO public."chatbot_suggested_questions" ("question", "sort_order")
        VALUES (
            question_value,
            COALESCE((SELECT max(s."sort_order") + 1
                        FROM public."chatbot_suggested_questions" AS s), 0)
        )
        RETURNING "suggested_question_id" INTO question_id_value;
    ELSE
        UPDATE public."chatbot_suggested_questions"
           SET "question" = question_value
         WHERE "suggested_question_id" = p_suggested_question_id
        RETURNING "suggested_question_id" INTO question_id_value;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Suggested question was not found';
        END IF;
    END IF;

    RETURN question_id_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_admin_chatbot_suggested_question(
    p_suggested_question_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_suggested_question_id IS NULL OR p_suggested_question_id < 1 THEN
        RAISE EXCEPTION 'Suggested question identifier is invalid';
    END IF;
    DELETE FROM public."chatbot_suggested_questions"
     WHERE "suggested_question_id" = p_suggested_question_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Suggested question was not found';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_chatbot_faqs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_my_admin_chatbot_faq(bigint, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_my_admin_chatbot_faq(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_admin_chatbot_suggested_questions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_my_admin_chatbot_suggested_question(bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_my_admin_chatbot_suggested_question(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_chatbot_faqs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_admin_chatbot_faq(bigint, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_admin_chatbot_faq(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_admin_chatbot_suggested_questions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_admin_chatbot_suggested_question(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_admin_chatbot_suggested_question(bigint) TO authenticated;
