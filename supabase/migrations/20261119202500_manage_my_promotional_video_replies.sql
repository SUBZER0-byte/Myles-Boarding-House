CREATE OR REPLACE FUNCTION public.update_my_promotional_video_reply(
    p_reply_id bigint,
    p_reply text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    app_user_id integer;
    reply_value text := btrim(COALESCE(p_reply, ''));
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to edit your reply.';
    END IF;
    app_user_id := public.current_app_user_id();
    IF app_user_id IS NULL THEN
        RAISE EXCEPTION 'An active account is required to edit a reply.';
    END IF;
    IF p_reply_id IS NULL OR p_reply_id <= 0
       OR length(reply_value) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Replies must be between 1 and 1,000 characters.';
    END IF;

    UPDATE public."promotional_video_replies"
       SET "reply" = reply_value
     WHERE "reply_id" = p_reply_id
       AND "user_id" = app_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'You can only edit your own replies.';
    END IF;

    RETURN jsonb_build_object('type', 'success', 'message', 'Reply updated.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_my_promotional_video_reply(p_reply_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    app_user_id integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to delete your reply.';
    END IF;
    app_user_id := public.current_app_user_id();
    IF app_user_id IS NULL THEN
        RAISE EXCEPTION 'An active account is required to delete a reply.';
    END IF;
    IF p_reply_id IS NULL OR p_reply_id <= 0 THEN
        RAISE EXCEPTION 'A valid reply is required.';
    END IF;

    DELETE FROM public."promotional_video_replies"
     WHERE "reply_id" = p_reply_id
       AND "user_id" = app_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'You can only delete your own replies.';
    END IF;

    RETURN jsonb_build_object('type', 'success', 'message', 'Reply deleted.');
END;
$function$;

REVOKE ALL ON FUNCTION public.update_my_promotional_video_reply(bigint, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_my_promotional_video_reply(bigint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_promotional_video_reply(bigint, text)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_promotional_video_reply(bigint)
    TO authenticated;
