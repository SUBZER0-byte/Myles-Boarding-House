ALTER TABLE public."ratings"
    DROP CONSTRAINT IF EXISTS "ratings_category_check";

ALTER TABLE public."ratings"
    ADD CONSTRAINT "ratings_category_check"
        CHECK ("category" IN (
            'Room Comfort',
            'Cleanliness',
            'Facilities',
            'Safety & Security',
            'Staff & Management',
            'Maintenance & Repairs',
            'Location & Accessibility',
            'Value for Money',
            'Services',
            'Overall Satisfaction'
        ));

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
       OR p_category IS NULL OR p_category NOT IN (
           'Room Comfort',
           'Cleanliness',
           'Facilities',
           'Safety & Security',
           'Staff & Management',
           'Maintenance & Repairs',
           'Location & Accessibility',
           'Value for Money',
           'Services',
           'Overall Satisfaction'
       )
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

REVOKE ALL ON FUNCTION public.submit_tenant_rating(uuid, numeric, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_tenant_rating(uuid, numeric, text, text)
    TO service_role;
