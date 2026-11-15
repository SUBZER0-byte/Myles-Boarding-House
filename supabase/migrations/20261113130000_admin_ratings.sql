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
                  SELECT r."rating_id", t."user_id",
                         u."profile_picture", t."full_name",
                         r."category", r."moderation_status", r."admin_reply",
                         r."stars", r."comment", r."created_at"
                    FROM public."ratings" AS r
                    LEFT JOIN public."tenants" AS t ON t."tenant_id" = r."tenant_id"
                    LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
              ) AS item;
            RETURN jsonb_build_object('type', 'success', 'data', v_result);

        WHEN 'summary' THEN
            SELECT jsonb_build_object(
                'total', count(*) FILTER (WHERE r."moderation_status" = 'Approved'),
                'average', COALESCE(avg(r."stars") FILTER (WHERE r."moderation_status" = 'Approved'), 0),
                'five', count(*) FILTER (WHERE r."moderation_status" = 'Approved' AND r."stars" = 5),
                'four_half', count(*) FILTER (WHERE r."moderation_status" = 'Approved' AND r."stars" = 4.5),
                'four', count(*) FILTER (WHERE r."moderation_status" = 'Approved' AND r."stars" = 4),
                'three_half', count(*) FILTER (WHERE r."moderation_status" = 'Approved' AND r."stars" = 3.5),
                'three', count(*) FILTER (WHERE r."moderation_status" = 'Approved' AND r."stars" = 3),
                'two_half', count(*) FILTER (WHERE r."moderation_status" = 'Approved' AND r."stars" = 2.5),
                'two', count(*) FILTER (WHERE r."moderation_status" = 'Approved' AND r."stars" = 2),
                'one_half', count(*) FILTER (WHERE r."moderation_status" = 'Approved' AND r."stars" = 1.5),
                'one', count(*) FILTER (WHERE r."moderation_status" = 'Approved' AND r."stars" = 1)
            )
              INTO v_result
              FROM public."ratings" AS r;
            RETURN jsonb_build_object('type', 'success', 'data', v_result);

        WHEN 'category_summary' THEN
            SELECT COALESCE(
                jsonb_agg(to_jsonb(item) ORDER BY item."category"),
                '[]'::jsonb
            )
              INTO v_result
              FROM (
                  SELECT r."category", count(*) AS "total", avg(r."stars") AS "average"
                    FROM public."ratings" AS r
                   WHERE r."moderation_status" = 'Approved'
                   GROUP BY r."category"
              ) AS item;
            RETURN jsonb_build_object('type', 'success', 'data', v_result);

        WHEN 'moderate' THEN
            IF COALESCE(p_data ->> 'rating_id', '') !~ '^\d{1,10}$'
               OR COALESCE(p_data ->> 'moderation_status', '') NOT IN ('Approved', 'Hidden') THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Choose Approve or Hide for a valid rating.');
            END IF;
            v_rating_id := (p_data ->> 'rating_id')::bigint;
            IF v_rating_id > 2147483647 THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Choose Approve or Hide for a valid rating.');
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
                'message', CASE WHEN v_status = 'Approved' THEN 'Feedback approved' ELSE 'Feedback hidden' END
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
            SELECT t."user_id"
              INTO v_tenant_user_id
              FROM public."ratings" AS r
              LEFT JOIN public."tenants" AS t ON t."tenant_id" = r."tenant_id"
             WHERE r."rating_id" = v_rating_id
             FOR UPDATE OF r;
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

REVOKE ALL ON FUNCTION public.manage_admin_ratings(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_admin_ratings(text, uuid, jsonb) TO service_role;
