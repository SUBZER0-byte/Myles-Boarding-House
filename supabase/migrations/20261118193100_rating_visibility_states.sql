ALTER TABLE public."ratings"
    DROP CONSTRAINT IF EXISTS "ratings_moderation_status_check";

UPDATE public."ratings"
   SET "moderation_status" = CASE
       WHEN "moderation_status" = 'Approved' THEN 'Revealed'
       ELSE 'Hidden'
   END;

ALTER TABLE public."ratings"
    ALTER COLUMN "moderation_status" SET DEFAULT 'Hidden',
    ADD CONSTRAINT "ratings_moderation_status_check"
        CHECK ("moderation_status" IN ('Hidden', 'Revealed'));

CREATE OR REPLACE FUNCTION public.get_public_reviews()
RETURNS TABLE (
    "stars" numeric(2,1),
    "category" text,
    "comment" text,
    "created_at" timestamp without time zone,
    "full_name" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        r."stars",
        r."category",
        r."comment",
        r."created_at",
        t."full_name"::text
    FROM public."ratings" AS r
    LEFT JOIN public."tenants" AS t ON t."tenant_id" = r."tenant_id"
    WHERE r."moderation_status" = 'Revealed'
    ORDER BY r."created_at" DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS TABLE (
    "total_rooms" bigint,
    "available_rooms" bigint,
    "happy_tenants" bigint,
    "avg_rating" numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        (SELECT COUNT(*) FROM public."rooms"),
        (SELECT COUNT(*) FROM public."rooms" WHERE "status" = 'Available'),
        (SELECT COUNT(*) FROM public."tenants" WHERE "is_active" = 1),
        COALESCE(
            (SELECT ROUND(AVG("stars"), 2)
             FROM public."ratings"
             WHERE "moderation_status" = 'Revealed'),
            0::numeric
        );
$function$;

CREATE OR REPLACE FUNCTION public.submit_tenant_rating(
    p_auth_user_id uuid,
    p_stars numeric,
    p_category text,
    p_comment text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    tenant_id integer;
    new_rating_id integer;
BEGIN
    SELECT t."tenant_id"
      INTO tenant_id
      FROM public."tenants" AS t
      INNER JOIN public."users" AS u ON u."user_id" = t."user_id"
     WHERE u."auth_user_id" = p_auth_user_id
       AND u."user_type" = 'Tenant'
       AND u."is_active" = 1
       AND t."is_active" = 1
     LIMIT 1;

    IF tenant_id IS NULL THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'Tenant access is required.');
    END IF;
    IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 OR p_stars * 2 <> round(p_stars * 2)
       OR p_category IS NULL OR p_category NOT IN ('Facilities', 'Services', 'Overall Satisfaction')
       OR p_comment IS NULL
       OR NULLIF(btrim(p_comment), '') IS NULL
       OR length(btrim(p_comment)) > 3000 THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'Choose a valid rating and category, and provide feedback up to 3,000 characters.');
    END IF;

    INSERT INTO public."ratings" ("tenant_id", "category", "stars", "comment", "moderation_status")
    VALUES (tenant_id, p_category, p_stars, btrim(p_comment), 'Hidden')
    RETURNING "rating_id" INTO new_rating_id;

    INSERT INTO public."notifications" ("user_id", "title", "message", "type")
    SELECT
        u."user_id",
        'New Hidden Rating',
        'A tenant submitted a ' || to_char(p_stars, 'FM9.0') ||
            '-star rating with written feedback. Reveal it to display publicly.',
        'rating'
    FROM public."users" AS u
    WHERE u."user_type" = 'Admin'
      AND u."is_active" = 1;

    RETURN jsonb_build_object(
        'type', 'success',
        'message', 'Rating submitted and hidden until it is revealed',
        'rating_id', new_rating_id
    );
END;
$function$;

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
                'total', count(*) FILTER (WHERE r."moderation_status" = 'Revealed'),
                'average', COALESCE(avg(r."stars") FILTER (WHERE r."moderation_status" = 'Revealed'), 0),
                'five', count(*) FILTER (WHERE r."moderation_status" = 'Revealed' AND r."stars" = 5),
                'four_half', count(*) FILTER (WHERE r."moderation_status" = 'Revealed' AND r."stars" = 4.5),
                'four', count(*) FILTER (WHERE r."moderation_status" = 'Revealed' AND r."stars" = 4),
                'three_half', count(*) FILTER (WHERE r."moderation_status" = 'Revealed' AND r."stars" = 3.5),
                'three', count(*) FILTER (WHERE r."moderation_status" = 'Revealed' AND r."stars" = 3),
                'two_half', count(*) FILTER (WHERE r."moderation_status" = 'Revealed' AND r."stars" = 2.5),
                'two', count(*) FILTER (WHERE r."moderation_status" = 'Revealed' AND r."stars" = 2),
                'one_half', count(*) FILTER (WHERE r."moderation_status" = 'Revealed' AND r."stars" = 1.5),
                'one', count(*) FILTER (WHERE r."moderation_status" = 'Revealed' AND r."stars" = 1)
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
                   WHERE r."moderation_status" = 'Revealed'
                   GROUP BY r."category"
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

REVOKE ALL ON FUNCTION public.submit_tenant_rating(uuid, numeric, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_tenant_rating(uuid, numeric, text, text)
    TO service_role;

REVOKE ALL ON FUNCTION public.manage_admin_ratings(text, uuid, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_admin_ratings(text, uuid, jsonb)
    TO service_role;

REVOKE ALL ON FUNCTION public.get_public_reviews() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_reviews() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;
