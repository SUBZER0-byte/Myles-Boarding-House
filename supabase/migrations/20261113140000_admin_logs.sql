CREATE OR REPLACE FUNCTION public.manage_admin_logs(
    p_action text,
    p_auth_user_id uuid,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    app_user_id integer;
    app_user_type text;
    v_log_id bigint;
    v_limit integer;
    v_category text;
    v_level text;
    v_query text;
    v_result jsonb;
BEGIN
    SELECT u."user_id", u."user_type"
      INTO app_user_id, app_user_type
      FROM public."users" AS u
     WHERE u."auth_user_id" = p_auth_user_id
       AND u."is_active" = 1;
    IF app_user_id IS NULL OR app_user_type <> 'Admin' THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'Administrator access is required.');
    END IF;

    CASE p_action
        WHEN 'list' THEN
            v_limit := CASE
                WHEN COALESCE(p_data ->> 'limit', '') ~ '^\d{1,3}$'
                    THEN LEAST(500, GREATEST(1, (p_data ->> 'limit')::integer))
                ELSE 300
            END;
            v_category := btrim(COALESCE(p_data ->> 'category', ''));
            v_level := btrim(COALESCE(p_data ->> 'level', ''));
            v_query := btrim(COALESCE(p_data ->> 'query', ''));

            SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item."log_id" DESC), '[]'::jsonb)
              INTO v_result
              FROM (
                  SELECT l."log_id", l."actor_id", u."username" AS "actor_username",
                         l."category", l."action", l."level", l."message",
                         l."ip_address", l."user_agent", l."request_path", l."created_at"
                    FROM public."system_logs" AS l
                    LEFT JOIN public."users" AS u ON u."user_id" = l."actor_id"
                   WHERE (v_category = '' OR l."category" = v_category)
                     AND (v_level = '' OR l."level" = v_level)
                     AND (v_query = '' OR l."message" ILIKE '%' || v_query || '%'
                                      OR l."action" ILIKE '%' || v_query || '%')
                   ORDER BY l."log_id" DESC
                   LIMIT v_limit
              ) AS item;
            RETURN jsonb_build_object('type', 'success', 'data', v_result);

        WHEN 'delete' THEN
            IF COALESCE(p_data ->> 'log_id', '') !~ '^\d{1,10}$' THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Missing or invalid log ID.');
            END IF;
            v_log_id := (p_data ->> 'log_id')::bigint;
            IF v_log_id > 2147483647 THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Missing or invalid log ID.');
            END IF;
            DELETE FROM public."system_logs" WHERE "log_id" = v_log_id;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Log entry not found.');
            END IF;
            RETURN jsonb_build_object('type', 'success', 'message', 'Log deleted.');

        ELSE
            RETURN jsonb_build_object('type', 'error', 'message', 'Invalid log action.');
    END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_admin_logs(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_admin_logs(text, uuid, jsonb) TO service_role;
