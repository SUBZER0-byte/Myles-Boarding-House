DO $$
DECLARE
    function_definition text;
    guest_peer_clause text := $old$AND (actor_role <> 'Guest' OR u."user_type" = 'Admin')$old$;
    tenant_peer_clause text := $new$AND (actor_role <> 'Guest' OR u."user_type" = 'Admin') AND (actor_role <> 'Tenant' OR u."user_type" IN ('Admin', 'Tenant'))$new$;
    unread_peer_clause text := $old$AND m."is_unsent" = 0$old$;
    unread_tenant_peer_clause text := $new$AND m."is_unsent" = 0 AND EXISTS ( SELECT 1 FROM public."users" AS sender WHERE sender."user_id" = m."from_user_id" AND (actor_role = 'Admin' OR (actor_role = 'Tenant' AND sender."user_type" IN ('Admin', 'Tenant')) OR (actor_role = 'Guest' AND sender."user_type" = 'Admin')) )$new$;
    old_error text := $old$RAISE EXCEPTION 'Guests may contact Admin users only';$old$;
    new_error text := $new$RAISE EXCEPTION 'This user is not available for chat';$new$;
    old_remove_check text := $old$IF mode_value = 'unsend' THEN$old$;
    new_remove_check text := $new$IF NOT EXISTS ( SELECT 1 FROM public."users" AS peer WHERE peer."user_id" = CASE WHEN message_row."from_user_id" = actor_id THEN message_row."to_user_id" ELSE message_row."from_user_id" END AND peer."is_active" = 1 AND (actor_role = 'Admin' OR (actor_role = 'Tenant' AND peer."user_type" IN ('Admin', 'Tenant')) OR (actor_role = 'Guest' AND peer."user_type" = 'Admin')) ) THEN RAISE EXCEPTION 'This user is not available for chat'; END IF;
        IF mode_value = 'unsend' THEN$new$;
    old_peer_clause_count integer;
    new_peer_clause_count integer;
    old_unread_clause_count integer;
    new_unread_clause_count integer;
    old_error_count integer;
    new_error_count integer;
    old_remove_check_count integer;
    new_remove_check_count integer;
BEGIN
    function_definition := pg_get_functiondef('public.manage_my_chat(text,jsonb)'::regprocedure);
    old_peer_clause_count :=
        (length(function_definition) - length(replace(function_definition, guest_peer_clause, '')))
        / length(guest_peer_clause);
    new_peer_clause_count :=
        (length(function_definition) - length(replace(function_definition, tenant_peer_clause, '')))
        / length(tenant_peer_clause);
    old_unread_clause_count :=
        (length(function_definition) - length(replace(function_definition, unread_peer_clause, '')))
        / length(unread_peer_clause);
    new_unread_clause_count :=
        (length(function_definition) - length(replace(function_definition, unread_tenant_peer_clause, '')))
        / length(unread_tenant_peer_clause);
    old_error_count :=
        (length(function_definition) - length(replace(function_definition, old_error, '')))
        / length(old_error);
    new_error_count :=
        (length(function_definition) - length(replace(function_definition, new_error, '')))
        / length(new_error);
    old_remove_check_count :=
        (length(function_definition) - length(replace(function_definition, old_remove_check, '')))
        / length(old_remove_check);
    new_remove_check_count :=
        (length(function_definition) - length(replace(function_definition, new_remove_check, '')))
        / length(new_remove_check);

    IF old_peer_clause_count = 3
       AND new_peer_clause_count = 0
       AND old_unread_clause_count = 1
       AND new_unread_clause_count = 0
       AND old_error_count = 2
       AND new_error_count = 0
       AND old_remove_check_count = 1
       AND new_remove_check_count = 0 THEN
        function_definition := replace(function_definition, guest_peer_clause, tenant_peer_clause);
        function_definition := replace(function_definition, unread_peer_clause, unread_tenant_peer_clause);
        function_definition := replace(function_definition, old_error, new_error);
        function_definition := replace(function_definition, old_remove_check, new_remove_check);
        EXECUTE function_definition;
    ELSIF old_peer_clause_count = 0
       AND new_peer_clause_count = 3
       AND old_unread_clause_count = 0
       AND new_unread_clause_count = 1
       AND old_error_count = 0
       AND new_error_count = 3
       AND old_remove_check_count = 0
       AND new_remove_check_count = 1 THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'Unexpected chat workflow function; tenant chat role restriction was not applied';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_chat_image(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public."chat_messages" AS m
         WHERE (m."from_user_id" = public.current_app_user_id()
                OR m."to_user_id" = public.current_app_user_id())
           AND m."is_unsent" = 0
           AND EXISTS (
               SELECT 1
                 FROM public."users" AS peer
                WHERE peer."user_id" = CASE
                    WHEN m."from_user_id" = public.current_app_user_id() THEN m."to_user_id"
                    ELSE m."from_user_id"
                END
                  AND peer."is_active" = 1
                  AND (
                      public.current_app_user_role() = 'Admin'
                      OR (public.current_app_user_role() = 'Tenant'
                          AND peer."user_type" IN ('Admin', 'Tenant'))
                      OR (public.current_app_user_role() = 'Guest'
                          AND peer."user_type" = 'Admin')
                  )
           )
           AND NOT EXISTS (
               SELECT 1
                 FROM public."chat_message_hidden" AS h
                WHERE h."message_id" = m."message_id"
                  AND h."user_id" = public.current_app_user_id()
           )
           AND (
               m."image_path" = p_path
               OR EXISTS (
                   SELECT 1
                     FROM public."chat_message_images" AS i
                    WHERE i."message_id" = m."message_id"
                      AND i."image_path" = p_path
               )
           )
    )
$$;

REVOKE ALL ON FUNCTION public.can_access_chat_image(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_chat_image(text) TO authenticated;
