CREATE OR REPLACE FUNCTION public.record_admin_management_log(
    p_entity text,
    p_operation text,
    p_resource_id integer,
    p_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    app_user_id integer;
    log_id_value bigint;
BEGIN
    SELECT u."user_id"
      INTO app_user_id
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."user_type" = 'Admin'
       AND u."is_active" = 1;
    IF app_user_id IS NULL THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    IF p_entity IS NULL OR p_entity NOT IN ('guest', 'tenant')
       OR p_operation IS NULL OR p_operation NOT IN ('read', 'create', 'update', 'delete') THEN
        RAISE EXCEPTION 'Invalid management audit event';
    END IF;
    IF (p_operation = 'read' AND p_resource_id IS NOT NULL AND p_resource_id <= 0)
       OR (p_operation <> 'read' AND (p_resource_id IS NULL OR p_resource_id <= 0)) THEN
        RAISE EXCEPTION 'A valid resource ID is required for this audit event';
    END IF;
    IF p_message IS NULL OR btrim(p_message) = '' OR char_length(p_message) > 500 THEN
        RAISE EXCEPTION 'A valid audit message is required';
    END IF;

    INSERT INTO public."system_logs" (
        "actor_id", "category", "action", "level", "message", "request_path"
    ) VALUES (
        app_user_id,
        'management',
        p_entity || '.' || p_operation,
        'info',
        btrim(p_message),
        CASE p_entity
            WHEN 'guest' THEN '/admin/guests'
            ELSE '/admin/tenants'
        END
    )
    RETURNING "log_id" INTO log_id_value;

    RETURN jsonb_build_object('type', 'success', 'log_id', log_id_value);
END;
$$;

REVOKE ALL ON FUNCTION public.record_admin_management_log(text, text, integer, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_admin_management_log(text, text, integer, text)
    TO authenticated;
