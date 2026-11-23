CREATE OR REPLACE FUNCTION public.get_public_rating_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    WITH revealed_ratings AS (
        SELECT "category", "stars"
          FROM public."ratings"
         WHERE "moderation_status" = 'Revealed'
    ),
    category_summary AS (
        SELECT "category",
               count(*) AS "total",
               round(avg("stars"), 2) AS "average"
          FROM revealed_ratings
         GROUP BY "category"
    )
    SELECT jsonb_build_object(
        'total_revealed', count(*),
        'overall_average', COALESCE(round(avg("stars"), 2), 0::numeric),
        'by_category', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'category', "category",
                        'total', "total",
                        'average', "average"
                    )
                    ORDER BY "category"
                )
                  FROM category_summary
            ),
            '[]'::jsonb
        )
    )
      FROM revealed_ratings;
$function$;

REVOKE ALL ON FUNCTION public.get_public_rating_summary()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_rating_summary()
    TO anon, authenticated, service_role;
