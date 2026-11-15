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
    WHERE r."moderation_status" = 'Approved'
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
             WHERE "moderation_status" = 'Approved'),
            0::numeric
        );
$function$;

REVOKE ALL PRIVILEGES ON TABLE public."ratings", public."tenants"
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_reviews() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_stats() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_public_reviews() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;
