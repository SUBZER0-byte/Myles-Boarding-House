CREATE OR REPLACE FUNCTION public.get_promotional_video_discussion()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT jsonb_build_object(
        'video_url', (
            SELECT settings."video_url"
              FROM public."promotional_video_settings" AS settings
             WHERE settings."setting_id" = 1
        ),
        'likes_count', (
            SELECT count(*) FROM public."promotional_video_likes"
        ),
        'comments_count', (
            SELECT count(*) FROM public."promotional_video_comments"
        ),
        'liked_by_me', CASE
            WHEN auth.uid() IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                  FROM public."promotional_video_likes" AS video_like
                  JOIN public."users" AS account ON account."user_id" = video_like."user_id"
                 WHERE account."auth_user_id" = auth.uid()
                   AND account."is_active" = 1
            )
        END,
        'comments', COALESCE((
            SELECT jsonb_agg(visible_comment."comment_data"
                ORDER BY visible_comment."created_at" DESC, visible_comment."comment_id" DESC
            )
              FROM (
                SELECT
                    jsonb_build_object(
                        'comment_id', video_comment."comment_id",
                        'full_name', COALESCE(
                            NULLIF(btrim(comment_owner."full_name"), ''),
                            comment_owner."username",
                            'User'
                        ),
                        'comment', video_comment."comment",
                        'created_at', video_comment."created_at",
                        'is_mine', comment_owner."is_mine"
                    ) AS "comment_data",
                    video_comment."created_at",
                    video_comment."comment_id",
                    comment_owner."is_mine",
                    comment_owner."list_position"
                  FROM public."promotional_video_comments" AS video_comment
                  JOIN (
                    SELECT video_comment."comment_id",
                           account."full_name",
                           account."username",
                           row_number() OVER (
                               ORDER BY video_comment."created_at" DESC, video_comment."comment_id" DESC
                           ) AS "list_position",
                           auth.uid() IS NOT NULL
                               AND account."auth_user_id" = auth.uid()
                               AND account."is_active" = 1 AS "is_mine"
                      FROM public."promotional_video_comments" AS video_comment
                      JOIN public."users" AS account ON account."user_id" = video_comment."user_id"
                  ) AS comment_owner ON comment_owner."comment_id" = video_comment."comment_id"
                 WHERE comment_owner."list_position" <= 100 OR comment_owner."is_mine"
              ) AS visible_comment
        ), '[]'::jsonb)
    );
$function$;

CREATE OR REPLACE FUNCTION public.update_my_promotional_video_comment(
    p_comment_id bigint,
    p_comment text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    app_user_id integer;
    comment_value text := btrim(COALESCE(p_comment, ''));
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to edit your comment.';
    END IF;
    app_user_id := public.current_app_user_id();
    IF app_user_id IS NULL THEN
        RAISE EXCEPTION 'An active account is required to edit a comment.';
    END IF;
    IF p_comment_id IS NULL OR p_comment_id <= 0
       OR length(comment_value) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Comments must be between 1 and 1,000 characters.';
    END IF;

    UPDATE public."promotional_video_comments"
       SET "comment" = comment_value
     WHERE "comment_id" = p_comment_id
       AND "user_id" = app_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'You can only edit your own comments.';
    END IF;

    RETURN jsonb_build_object('type', 'success', 'message', 'Comment updated.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_my_promotional_video_comment(p_comment_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    app_user_id integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to delete your comment.';
    END IF;
    app_user_id := public.current_app_user_id();
    IF app_user_id IS NULL THEN
        RAISE EXCEPTION 'An active account is required to delete a comment.';
    END IF;
    IF p_comment_id IS NULL OR p_comment_id <= 0 THEN
        RAISE EXCEPTION 'A valid comment is required.';
    END IF;

    DELETE FROM public."promotional_video_comments"
     WHERE "comment_id" = p_comment_id
       AND "user_id" = app_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'You can only delete your own comments.';
    END IF;

    RETURN jsonb_build_object('type', 'success', 'message', 'Comment deleted.');
END;
$function$;

REVOKE ALL ON FUNCTION public.update_my_promotional_video_comment(bigint, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_my_promotional_video_comment(bigint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_promotional_video_comment(bigint, text)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_promotional_video_comment(bigint)
    TO authenticated;
