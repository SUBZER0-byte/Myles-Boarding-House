CREATE OR REPLACE FUNCTION public.get_tenant_ratings(p_auth_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'rating_id', r."rating_id",
                'category', r."category",
                'moderation_status', r."moderation_status",
                'admin_reply', r."admin_reply",
                'stars', r."stars",
                'comment', r."comment",
                'created_at', r."created_at"
            )
            ORDER BY r."created_at" DESC
        ),
        '[]'::jsonb
    )
    FROM public."ratings" AS r
    INNER JOIN public."tenants" AS t ON t."tenant_id" = r."tenant_id"
    INNER JOIN public."users" AS u ON u."user_id" = t."user_id"
    WHERE u."auth_user_id" = p_auth_user_id
      AND u."user_type" = 'Tenant'
      AND u."is_active" = 1
      AND t."is_active" = 1;
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
    VALUES (tenant_id, p_category, p_stars, btrim(p_comment), 'Pending')
    RETURNING "rating_id" INTO new_rating_id;

    INSERT INTO public."notifications" ("user_id", "title", "message", "type")
    SELECT
        u."user_id",
        'Rating Awaiting Review',
        'A tenant submitted a ' || to_char(p_stars, 'FM9.0') ||
            '-star rating with written feedback.',
        'rating'
    FROM public."users" AS u
    WHERE u."user_type" = 'Admin'
      AND u."is_active" = 1;

    RETURN jsonb_build_object(
        'type', 'success',
        'message', 'Feedback submitted for review',
        'rating_id', new_rating_id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_tenant_ratings(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_tenant_rating(uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_ratings(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_tenant_rating(uuid, numeric, text, text) TO service_role;
