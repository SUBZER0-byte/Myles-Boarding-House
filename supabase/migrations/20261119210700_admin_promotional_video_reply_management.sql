CREATE OR REPLACE FUNCTION public.manage_admin_promotional_video_replies(
    p_action text,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    reply_id_value bigint;
    result_replies jsonb;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required.';
    END IF;

    CASE p_action
        WHEN 'list' THEN
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'reply_id', reply_item."reply_id",
                        'comment_id', reply_item."comment_id",
                        'full_name', COALESCE(
                            NULLIF(btrim(reply_item."full_name"), ''),
                            reply_item."username",
                            'User'
                        ),
                        'username', reply_item."username",
                        'reply', reply_item."reply",
                        'created_at', reply_item."created_at",
                        'likes_count', reply_item."likes_count",
                        'comment', reply_item."comment",
                        'commenter_name', COALESCE(
                            NULLIF(btrim(reply_item."commenter_name"), ''),
                            reply_item."commenter_username",
                            'User'
                        )
                    )
                    ORDER BY reply_item."created_at" DESC, reply_item."reply_id" DESC
                ),
                '[]'::jsonb
            )
              INTO result_replies
              FROM (
                SELECT video_reply."reply_id",
                       video_reply."comment_id",
                       reply_author."full_name",
                       reply_author."username",
                       video_reply."reply",
                       video_reply."created_at",
                       (SELECT count(*)
                          FROM public."promotional_video_discussion_likes" AS reply_like
                         WHERE reply_like."reply_id" = video_reply."reply_id"
                       ) AS "likes_count",
                       parent_comment."comment",
                       comment_author."full_name" AS "commenter_name",
                       comment_author."username" AS "commenter_username"
                  FROM public."promotional_video_replies" AS video_reply
                  JOIN public."users" AS reply_author
                    ON reply_author."user_id" = video_reply."user_id"
                  JOIN public."promotional_video_comments" AS parent_comment
                    ON parent_comment."comment_id" = video_reply."comment_id"
                  JOIN public."users" AS comment_author
                    ON comment_author."user_id" = parent_comment."user_id"
              ) AS reply_item;
            RETURN jsonb_build_object('type', 'success', 'replies', result_replies);

        WHEN 'delete' THEN
            IF COALESCE(p_data ->> 'reply_id', '') !~ '^\d{1,19}$' THEN
                RAISE EXCEPTION 'A valid reply is required.';
            END IF;
            IF (p_data ->> 'reply_id')::numeric > 9223372036854775807 THEN
                RAISE EXCEPTION 'A valid reply is required.';
            END IF;
            reply_id_value := (p_data ->> 'reply_id')::bigint;
            IF reply_id_value <= 0 THEN
                RAISE EXCEPTION 'A valid reply is required.';
            END IF;

            DELETE FROM public."promotional_video_replies"
             WHERE "reply_id" = reply_id_value;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Reply not found.';
            END IF;
            RETURN jsonb_build_object('type', 'success', 'message', 'Reply deleted.');

        ELSE
            RAISE EXCEPTION 'Invalid promotional video reply management action.';
    END CASE;
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_admin_promotional_video_replies(text, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_admin_promotional_video_replies(text, jsonb)
    TO authenticated;
