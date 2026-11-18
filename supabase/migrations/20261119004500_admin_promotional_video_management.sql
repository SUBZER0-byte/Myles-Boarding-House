CREATE TABLE IF NOT EXISTS public."promotional_video_settings" (
    "setting_id" smallint PRIMARY KEY CHECK ("setting_id" = 1),
    "video_url" text NOT NULL,
    "updated_by" integer REFERENCES public."users" ("user_id") ON DELETE SET NULL,
    "updated_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public."promotional_video_settings" ("setting_id", "video_url")
VALUES (1, 'https://www.youtube.com/watch?v=KitgNbL8I4A')
ON CONFLICT ("setting_id") DO NOTHING;

ALTER TABLE public."promotional_video_settings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."promotional_video_settings" FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public."promotional_video_settings" TO service_role;

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
            SELECT jsonb_agg(recent_comment."comment_data"
                ORDER BY recent_comment."created_at" DESC, recent_comment."comment_id" DESC
            )
              FROM (
                SELECT
                    jsonb_build_object(
                        'comment_id', video_comment."comment_id",
                        'full_name', COALESCE(NULLIF(btrim(account."full_name"), ''), account."username", 'User'),
                        'comment', video_comment."comment",
                        'created_at', video_comment."created_at"
                    ) AS "comment_data",
                    video_comment."created_at",
                    video_comment."comment_id"
                  FROM public."promotional_video_comments" AS video_comment
                  JOIN public."users" AS account ON account."user_id" = video_comment."user_id"
                 ORDER BY video_comment."created_at" DESC, video_comment."comment_id" DESC
                 LIMIT 100
              ) AS recent_comment
        ), '[]'::jsonb)
    );
$function$;

CREATE OR REPLACE FUNCTION public.manage_admin_promotional_video(
    p_action text,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    app_user_id integer;
    video_url_value text;
    record_id bigint;
    result_data jsonb;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required.';
    END IF;
    app_user_id := public.current_app_user_id();

    CASE p_action
        WHEN 'list' THEN
            SELECT jsonb_build_object(
                'video_url', (
                    SELECT settings."video_url"
                      FROM public."promotional_video_settings" AS settings
                     WHERE settings."setting_id" = 1
                ),
                'comments', COALESCE((
                    SELECT jsonb_agg(to_jsonb(comment_item)
                        ORDER BY comment_item."created_at" DESC, comment_item."comment_id" DESC
                    )
                      FROM (
                        SELECT video_comment."comment_id",
                               video_comment."user_id",
                               COALESCE(NULLIF(btrim(account."full_name"), ''), account."username", 'User') AS "full_name",
                               account."username",
                               video_comment."comment",
                               video_comment."created_at"
                          FROM public."promotional_video_comments" AS video_comment
                          JOIN public."users" AS account ON account."user_id" = video_comment."user_id"
                      ) AS comment_item
                ), '[]'::jsonb),
                'likes', COALESCE((
                    SELECT jsonb_agg(to_jsonb(like_item)
                        ORDER BY like_item."created_at" DESC, like_item."user_id"
                    )
                      FROM (
                        SELECT video_like."user_id",
                               COALESCE(NULLIF(btrim(account."full_name"), ''), account."username", 'User') AS "full_name",
                               account."username",
                               video_like."created_at"
                          FROM public."promotional_video_likes" AS video_like
                          JOIN public."users" AS account ON account."user_id" = video_like."user_id"
                      ) AS like_item
                ), '[]'::jsonb)
            )
              INTO result_data;
            RETURN jsonb_build_object('type', 'success', 'data', result_data);

        WHEN 'save_video_url' THEN
            video_url_value := btrim(COALESCE(p_data ->> 'video_url', ''));
            IF length(video_url_value) > 2048
               OR (
                  video_url_value !~* '^https?://(www\.|m\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}([&][^[:space:]]*)?$'
                  AND video_url_value !~* '^https?://(www\.|m\.)?youtube\.com/(embed|shorts|live)/[A-Za-z0-9_-]{11}([?][^[:space:]]*)?$'
                  AND video_url_value !~* '^https?://youtu\.be/[A-Za-z0-9_-]{11}([?][^[:space:]]*)?$'
               ) THEN
                RAISE EXCEPTION 'Enter a valid YouTube video URL.';
            END IF;

            INSERT INTO public."promotional_video_settings" (
                "setting_id", "video_url", "updated_by", "updated_at"
            )
            VALUES (1, video_url_value, app_user_id, CURRENT_TIMESTAMP)
            ON CONFLICT ("setting_id") DO UPDATE
                SET "video_url" = EXCLUDED."video_url",
                    "updated_by" = EXCLUDED."updated_by",
                    "updated_at" = EXCLUDED."updated_at";
            RETURN jsonb_build_object('type', 'success', 'message', 'Promotional video URL saved.');

        WHEN 'delete_comment' THEN
            IF COALESCE(p_data ->> 'comment_id', '') !~ '^\d{1,19}$' THEN
                RAISE EXCEPTION 'A valid comment is required.';
            END IF;
            record_id := (p_data ->> 'comment_id')::bigint;
            DELETE FROM public."promotional_video_comments"
             WHERE "comment_id" = record_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Comment not found.';
            END IF;
            RETURN jsonb_build_object('type', 'success', 'message', 'Comment deleted.');

        WHEN 'delete_like' THEN
            IF COALESCE(p_data ->> 'user_id', '') !~ '^\d{1,10}$'
               OR (p_data ->> 'user_id')::bigint > 2147483647 THEN
                RAISE EXCEPTION 'A valid like is required.';
            END IF;
            DELETE FROM public."promotional_video_likes"
             WHERE "user_id" = (p_data ->> 'user_id')::integer;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Like not found.';
            END IF;
            RETURN jsonb_build_object('type', 'success', 'message', 'Like removed.');

        ELSE
            RAISE EXCEPTION 'Invalid promotional video management action.';
    END CASE;
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_admin_promotional_video(text, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_admin_promotional_video(text, jsonb)
    TO authenticated;
