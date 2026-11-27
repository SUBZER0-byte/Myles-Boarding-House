CREATE TABLE public."tenant_rating_category_claims" (
    "user_id" integer NOT NULL
        REFERENCES public."users" ("user_id") ON DELETE CASCADE,
    "category" text NOT NULL,
    "claimed_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("user_id", "category")
);

ALTER TABLE public."tenant_rating_category_claims" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."tenant_rating_category_claims"
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public."tenant_rating_category_claims"
    TO service_role;

INSERT INTO public."tenant_rating_category_claims" ("user_id", "category")
SELECT DISTINCT tenant."user_id", rating."category"
  FROM public."ratings" AS rating
  INNER JOIN public."tenants" AS tenant
    ON tenant."tenant_id" = rating."tenant_id"
 WHERE tenant."user_id" IS NOT NULL
ON CONFLICT ("user_id", "category") DO NOTHING;

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
                'rating_id', rating."rating_id",
                'category', rating."category",
                'moderation_status', rating."moderation_status",
                'admin_reply', rating."admin_reply",
                'stars', rating."stars",
                'comment', rating."comment",
                'created_at', rating."created_at"
            )
            ORDER BY rating."created_at" DESC
        ),
        '[]'::jsonb
    )
    FROM public."ratings" AS rating
    INNER JOIN public."tenants" AS tenant
      ON tenant."tenant_id" = rating."tenant_id"
    INNER JOIN public."users" AS account
      ON account."user_id" = tenant."user_id"
   WHERE account."auth_user_id" = p_auth_user_id
     AND account."user_type" = 'Tenant'
     AND account."is_active" = 1;
$function$;

REVOKE ALL ON FUNCTION public.get_tenant_ratings(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_ratings(uuid)
    TO service_role;

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
    user_id integer;
    new_rating_id integer;
BEGIN
    SELECT t."tenant_id", u."user_id"
      INTO tenant_id, user_id
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

    INSERT INTO public."tenant_rating_category_claims" ("user_id", "category")
    VALUES (user_id, p_category)
    ON CONFLICT ("user_id", "category") DO NOTHING;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'type', 'error',
            'message', 'You have already submitted a rating for this category.'
        );
    END IF;

    INSERT INTO public."ratings" ("tenant_id", "category", "stars", "comment", "moderation_status")
    VALUES (tenant_id, p_category, p_stars, btrim(p_comment), 'Revealed')
    RETURNING "rating_id" INTO new_rating_id;

    INSERT INTO public."notifications" ("user_id", "title", "message", "type")
    SELECT
        u."user_id",
        'New Rating Submitted',
        'A tenant submitted a ' || to_char(p_stars, 'FM9.0') ||
            '-star rating with written feedback. It is now visible publicly.',
        'rating'
    FROM public."users" AS u
    WHERE u."user_type" = 'Admin'
      AND u."is_active" = 1;

    RETURN jsonb_build_object(
        'type', 'success',
        'message', 'Rating submitted and is now visible',
        'rating_id', new_rating_id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_tenant_rating(uuid, numeric, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_tenant_rating(uuid, numeric, text, text)
    TO service_role;
