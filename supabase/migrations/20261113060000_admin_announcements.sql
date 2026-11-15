CREATE OR REPLACE FUNCTION public.manage_admin_announcement(
    p_action text,
    p_auth_user_id uuid,
    p_announcement_id integer DEFAULT NULL,
    p_title text DEFAULT NULL,
    p_body text DEFAULT NULL,
    p_is_published smallint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    caller_user_id integer;
    announcement_title text;
    previous_published smallint;
    affected_rows integer;
    new_announcement_id integer;
BEGIN
    SELECT u."user_id"
      INTO caller_user_id
      FROM public."users" AS u
     WHERE u."auth_user_id" = p_auth_user_id
       AND u."user_type" = 'Admin'
       AND u."is_active" = 1
     LIMIT 1;

    IF caller_user_id IS NULL THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'Administrator access is required.');
    END IF;

    IF p_action = 'list' THEN
        RETURN jsonb_build_object(
            'type', 'success',
            'data', COALESCE(
                (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."created_at" DESC)
                   FROM public."announcements" AS a),
                '[]'::jsonb
            )
        );
    ELSIF p_action IN ('create', 'update') THEN
        IF NULLIF(btrim(p_title), '') IS NULL
           OR length(btrim(p_title)) > 200
           OR NULLIF(btrim(p_body), '') IS NULL THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Enter a title and announcement body.');
        END IF;

        IF p_action = 'create' THEN
            INSERT INTO public."announcements" ("title", "body", "author_id", "is_published")
            VALUES (
                btrim(p_title),
                btrim(p_body),
                caller_user_id,
                CASE WHEN p_is_published = 0 THEN 0 ELSE 1 END
            )
            RETURNING "announcement_id" INTO new_announcement_id;

            IF p_is_published IS DISTINCT FROM 0 THEN
                INSERT INTO public."notifications" ("user_id", "title", "message", "type")
                SELECT
                    u."user_id",
                    'New Announcement',
                    'A new announcement is available: ' || btrim(p_title) || '.',
                    'announcement'
                FROM public."users" AS u
                WHERE u."user_type" IN ('Tenant', 'Guest')
                  AND u."is_active" = 1;
            END IF;

            RETURN jsonb_build_object(
                'type', 'success',
                'message', 'Created',
                'announcement_id', new_announcement_id
            );
        END IF;

        UPDATE public."announcements"
           SET "title" = btrim(p_title),
               "body" = btrim(p_body)
         WHERE "announcement_id" = p_announcement_id;
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows = 0 THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Announcement not found.');
        END IF;
        RETURN jsonb_build_object('type', 'success', 'message', 'Updated');
    ELSIF p_action = 'publish' THEN
        IF p_announcement_id IS NULL OR p_is_published IS NULL OR p_is_published NOT IN (0, 1) THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'A valid announcement and publish status are required.');
        END IF;

        SELECT a."title", a."is_published"
          INTO announcement_title, previous_published
          FROM public."announcements" AS a
         WHERE a."announcement_id" = p_announcement_id;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Announcement not found.');
        END IF;

        UPDATE public."announcements"
           SET "is_published" = p_is_published
         WHERE "announcement_id" = p_announcement_id;

        IF previous_published = 0 AND p_is_published = 1 THEN
            INSERT INTO public."notifications" ("user_id", "title", "message", "type")
            SELECT
                u."user_id",
                'New Announcement',
                'A new announcement is available: ' || announcement_title || '.',
                'announcement'
            FROM public."users" AS u
            WHERE u."user_type" IN ('Tenant', 'Guest')
              AND u."is_active" = 1;
        END IF;

        RETURN jsonb_build_object('type', 'success', 'message', 'Updated');
    ELSIF p_action = 'delete' THEN
        IF p_announcement_id IS NULL THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'A valid announcement is required.');
        END IF;
        DELETE FROM public."announcements"
         WHERE "announcement_id" = p_announcement_id;
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows = 0 THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Announcement not found.');
        END IF;
        RETURN jsonb_build_object('type', 'success', 'message', 'Deleted');
    END IF;

    RETURN jsonb_build_object('type', 'error', 'message', 'Invalid announcement action.');
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_admin_announcement(text, uuid, integer, text, text, smallint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_admin_announcement(text, uuid, integer, text, text, smallint)
    TO service_role;
