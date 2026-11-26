CREATE OR REPLACE FUNCTION public.broadcast_public_rating_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    PERFORM realtime.send(
        payload => jsonb_build_object('refresh', true),
        event => 'ratings_changed',
        topic => 'public:rating-updates',
        private => true
    );
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_public_rating_changes()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS "ratings_broadcast_public_changes" ON public."ratings";
CREATE TRIGGER "ratings_broadcast_public_changes"
    AFTER INSERT OR UPDATE OR DELETE ON public."ratings"
    FOR EACH ROW
    EXECUTE FUNCTION public.broadcast_public_rating_changes();

DROP POLICY IF EXISTS "Public rating refresh broadcasts are readable" ON realtime.messages;
CREATE POLICY "Public rating refresh broadcasts are readable"
    ON realtime.messages
    FOR SELECT
    TO anon, authenticated
    USING (
        extension = 'broadcast'
        AND topic = 'public:rating-updates'
    );
