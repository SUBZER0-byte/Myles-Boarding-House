DROP FUNCTION IF EXISTS public.get_public_reviews();

CREATE FUNCTION public.get_public_reviews()
RETURNS TABLE (
    "stars" numeric(2,1),
    "category" text,
    "comment" text,
    "created_at" timestamp without time zone,
    "full_name" text,
    "room_number" varchar(40)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        rating."stars",
        rating."category",
        rating."comment",
        rating."created_at",
        tenant."full_name"::text,
        room."room_number"
    FROM public."ratings" AS rating
    LEFT JOIN public."tenants" AS tenant ON tenant."tenant_id" = rating."tenant_id"
    LEFT JOIN public."rooms" AS room ON room."room_id" = tenant."room_id"
    WHERE rating."moderation_status" = 'Revealed'
    ORDER BY rating."created_at" DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_public_reviews() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_reviews() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.manage_admin_ratings(
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
    v_rating_id bigint;
    v_status text;
    v_reply text;
    v_tenant_user_id integer;
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
            SELECT COALESCE(
                jsonb_agg(to_jsonb(item) ORDER BY item."created_at" DESC),
                '[]'::jsonb
            )
              INTO v_result
              FROM (
                  SELECT rating."rating_id", tenant."user_id",
                         account."profile_picture", tenant."full_name",
                         room."room_number",
                         rating."category", rating."moderation_status", rating."admin_reply",
                         rating."stars", rating."comment", rating."created_at"
                    FROM public."ratings" AS rating
                    LEFT JOIN public."tenants" AS tenant ON tenant."tenant_id" = rating."tenant_id"
                    LEFT JOIN public."users" AS account ON account."user_id" = tenant."user_id"
                    LEFT JOIN public."rooms" AS room ON room."room_id" = tenant."room_id"
              ) AS item;
            RETURN jsonb_build_object('type', 'success', 'data', v_result);

        WHEN 'summary' THEN
            SELECT jsonb_build_object(
                'total', count(*) FILTER (WHERE rating."moderation_status" = 'Revealed'),
                'average', COALESCE(avg(rating."stars") FILTER (WHERE rating."moderation_status" = 'Revealed'), 0),
                'five', count(*) FILTER (WHERE rating."moderation_status" = 'Revealed' AND rating."stars" = 5),
                'four_half', count(*) FILTER (WHERE rating."moderation_status" = 'Revealed' AND rating."stars" = 4.5),
                'four', count(*) FILTER (WHERE rating."moderation_status" = 'Revealed' AND rating."stars" = 4),
                'three_half', count(*) FILTER (WHERE rating."moderation_status" = 'Revealed' AND rating."stars" = 3.5),
                'three', count(*) FILTER (WHERE rating."moderation_status" = 'Revealed' AND rating."stars" = 3),
                'two_half', count(*) FILTER (WHERE rating."moderation_status" = 'Revealed' AND rating."stars" = 2.5),
                'two', count(*) FILTER (WHERE rating."moderation_status" = 'Revealed' AND rating."stars" = 2),
                'one_half', count(*) FILTER (WHERE rating."moderation_status" = 'Revealed' AND rating."stars" = 1.5),
                'one', count(*) FILTER (WHERE rating."moderation_status" = 'Revealed' AND rating."stars" = 1)
            )
              INTO v_result
              FROM public."ratings" AS rating;
            RETURN jsonb_build_object('type', 'success', 'data', v_result);

        WHEN 'category_summary' THEN
            SELECT COALESCE(
                jsonb_agg(to_jsonb(item) ORDER BY item."category"),
                '[]'::jsonb
            )
              INTO v_result
              FROM (
                  SELECT rating."category", count(*) AS "total", avg(rating."stars") AS "average"
                    FROM public."ratings" AS rating
                   WHERE rating."moderation_status" = 'Revealed'
                   GROUP BY rating."category"
              ) AS item;
            RETURN jsonb_build_object('type', 'success', 'data', v_result);

        WHEN 'moderate' THEN
            IF COALESCE(p_data ->> 'rating_id', '') !~ '^\d{1,10}$'
               OR COALESCE(p_data ->> 'moderation_status', '') NOT IN ('Revealed', 'Hidden') THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Choose Reveal or Hide for a valid rating.');
            END IF;
            v_rating_id := (p_data ->> 'rating_id')::bigint;
            IF v_rating_id > 2147483647 THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Choose Reveal or Hide for a valid rating.');
            END IF;
            v_status := p_data ->> 'moderation_status';
            UPDATE public."ratings"
               SET "moderation_status" = v_status
             WHERE "rating_id" = v_rating_id;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Rating not found.');
            END IF;
            RETURN jsonb_build_object(
                'type', 'success',
                'message', CASE WHEN v_status = 'Revealed' THEN 'Rating revealed' ELSE 'Rating hidden' END
            );

        WHEN 'reply' THEN
            IF COALESCE(p_data ->> 'rating_id', '') !~ '^\d{1,10}$' THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Enter a reply of 1 to 3,000 characters.');
            END IF;
            v_rating_id := (p_data ->> 'rating_id')::bigint;
            v_reply := btrim(COALESCE(p_data ->> 'admin_reply', ''));
            IF v_rating_id > 2147483647 OR v_reply = '' OR length(v_reply) > 3000 THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Enter a reply of 1 to 3,000 characters.');
            END IF;
            SELECT tenant."user_id"
              INTO v_tenant_user_id
              FROM public."ratings" AS rating
              LEFT JOIN public."tenants" AS tenant ON tenant."tenant_id" = rating."tenant_id"
             WHERE rating."rating_id" = v_rating_id
             FOR UPDATE OF rating;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Rating not found.');
            END IF;
            UPDATE public."ratings"
               SET "admin_reply" = v_reply,
                   "replied_at" = CURRENT_TIMESTAMP
             WHERE "rating_id" = v_rating_id;
            IF v_tenant_user_id IS NOT NULL THEN
                INSERT INTO public."notifications" ("user_id", "title", "message", "type")
                VALUES (
                    v_tenant_user_id,
                    'Admin Replied to Your Feedback',
                    'The administrator replied to your rating feedback.',
                    'rating'
                );
            END IF;
            RETURN jsonb_build_object('type', 'success', 'message', 'Reply sent');

        WHEN 'delete' THEN
            IF COALESCE(p_data ->> 'rating_id', '') !~ '^\d{1,10}$' THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'A valid rating ID is required.');
            END IF;
            v_rating_id := (p_data ->> 'rating_id')::bigint;
            IF v_rating_id > 2147483647 THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'A valid rating ID is required.');
            END IF;
            DELETE FROM public."ratings" WHERE "rating_id" = v_rating_id;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Rating not found.');
            END IF;
            RETURN jsonb_build_object('type', 'success', 'message', 'Deleted');

        ELSE
            RETURN jsonb_build_object('type', 'error', 'message', 'Invalid rating action.');
    END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_admin_ratings(text, uuid, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_admin_ratings(text, uuid, jsonb)
    TO service_role;
