-- Authenticated chat operations and private image attachments.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'mbh-chat-images',
    'mbh-chat-images',
    false,
    31457280,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 31457280,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

REVOKE ALL ON TABLE public."chat_messages",
    public."chat_message_images",
    public."chat_message_hidden"
FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS "chat_messages_from_to_created_idx"
    ON public."chat_messages" ("from_user_id", "to_user_id", "created_at" DESC, "message_id" DESC);
CREATE INDEX IF NOT EXISTS "chat_messages_to_from_created_idx"
    ON public."chat_messages" ("to_user_id", "from_user_id", "created_at" DESC, "message_id" DESC);
CREATE INDEX IF NOT EXISTS "chat_messages_unread_recipient_idx"
    ON public."chat_messages" ("to_user_id", "created_at" DESC)
    WHERE "is_read" = 0 AND "is_unsent" = 0;
CREATE INDEX IF NOT EXISTS "chat_message_hidden_user_message_idx"
    ON public."chat_message_hidden" ("user_id", "message_id");

CREATE OR REPLACE FUNCTION public.can_access_chat_image(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public."chat_messages" AS m
         WHERE (m."from_user_id" = public.current_app_user_id()
                OR m."to_user_id" = public.current_app_user_id())
           AND m."is_unsent" = 0
           AND NOT EXISTS (
               SELECT 1
                 FROM public."chat_message_hidden" AS h
                WHERE h."message_id" = m."message_id"
                  AND h."user_id" = public.current_app_user_id()
           )
           AND (
               m."image_path" = p_path
               OR EXISTS (
                   SELECT 1
                     FROM public."chat_message_images" AS i
                    WHERE i."message_id" = m."message_id"
                      AND i."image_path" = p_path
               )
           )
    )
$$;

REVOKE ALL ON FUNCTION public.can_access_chat_image(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_chat_image(text) TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects'
           AND policyname = 'mbh_chat_images_insert_own'
    ) THEN
        CREATE POLICY "mbh_chat_images_insert_own"
            ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'mbh-chat-images'
                AND (storage.foldername(name))[1] = auth.uid()::text
                AND public.current_app_user_role() IN ('Admin', 'Tenant', 'Guest')
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects'
           AND policyname = 'mbh_chat_images_read_participants'
    ) THEN
        CREATE POLICY "mbh_chat_images_read_participants"
            ON storage.objects FOR SELECT TO authenticated
            USING (
                bucket_id = 'mbh-chat-images'
                AND public.can_access_chat_image(name)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects'
           AND policyname = 'mbh_chat_images_delete_own'
    ) THEN
        CREATE POLICY "mbh_chat_images_delete_own"
            ON storage.objects FOR DELETE TO authenticated
            USING (
                bucket_id = 'mbh-chat-images'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_my_chat(
    p_action text,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    actor_id integer;
    actor_role text;
    peer_id_value integer;
    message_id_value integer;
    message_row public."chat_messages"%ROWTYPE;
    image_paths jsonb;
    image_path_value text;
    mode_value text;
    result jsonb;
BEGIN
    actor_id := public.current_app_user_id();
    actor_role := public.current_app_user_role();
    IF actor_id IS NULL OR actor_role IS NULL THEN
        RAISE EXCEPTION 'An active authenticated account is required';
    END IF;

    IF p_action = 'unread_count' THEN
        SELECT count(*)::integer
          INTO peer_id_value
          FROM public."chat_messages" AS m
         WHERE m."to_user_id" = actor_id
           AND m."is_read" = 0
           AND m."is_unsent" = 0
           AND NOT EXISTS (
               SELECT 1 FROM public."chat_message_hidden" AS h
                WHERE h."message_id" = m."message_id"
                  AND h."user_id" = actor_id
           );
        RETURN jsonb_build_object('type', 'success', 'data', jsonb_build_object('count', peer_id_value));

    ELSIF p_action = 'conversations' THEN
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'user_id', u."user_id",
                    'full_name', u."full_name",
                    'username', u."username",
                    'email', u."email",
                    'user_type', u."user_type",
                    'profile_picture', u."profile_picture",
                    'last_message', latest."last_message",
                    'last_at', latest."last_at"
                )
                ORDER BY (latest."last_at" IS NULL), latest."last_at" DESC NULLS LAST,
                    u."username"
            ),
            '[]'::jsonb
        )
          INTO result
          FROM public."users" AS u
          LEFT JOIN LATERAL (
              SELECT CASE
                         WHEN m."is_unsent" = 1 THEN 'Message unsent'
                         WHEN (m."image_path" IS NOT NULL OR EXISTS (
                             SELECT 1 FROM public."chat_message_images" AS i
                              WHERE i."message_id" = m."message_id"
                         )) AND m."body" = '' THEN '📷 Photo'
                         ELSE m."body"
                     END AS "last_message",
                     m."created_at" AS "last_at"
                FROM public."chat_messages" AS m
               WHERE ((m."from_user_id" = u."user_id" AND m."to_user_id" = actor_id)
                   OR (m."to_user_id" = u."user_id" AND m."from_user_id" = actor_id))
                 AND NOT EXISTS (
                     SELECT 1 FROM public."chat_message_hidden" AS h
                      WHERE h."message_id" = m."message_id"
                        AND h."user_id" = actor_id
                 )
               ORDER BY m."created_at" DESC, m."message_id" DESC
               LIMIT 1
          ) AS latest ON true
         WHERE u."user_id" <> actor_id
           AND u."is_active" = 1
           AND (actor_role <> 'Guest' OR u."user_type" = 'Admin');
        RETURN jsonb_build_object('type', 'success', 'data', result);

    ELSIF p_action = 'messages' THEN
        IF COALESCE(p_data->>'peer_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'A valid conversation is required';
        END IF;
        peer_id_value := (p_data->>'peer_id')::integer;
        IF peer_id_value = actor_id THEN
            RETURN jsonb_build_object('type', 'success', 'data', '[]'::jsonb);
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public."users" AS u
             WHERE u."user_id" = peer_id_value
               AND u."is_active" = 1
               AND (actor_role <> 'Guest' OR u."user_type" = 'Admin')
        ) THEN
            RAISE EXCEPTION 'Guests may contact Admin users only';
        END IF;

        UPDATE public."chat_messages"
           SET "is_read" = 1
         WHERE "from_user_id" = peer_id_value
           AND "to_user_id" = actor_id
           AND "is_read" = 0
           AND "is_unsent" = 0;

        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'message_id', m."message_id",
                    'from_user_id', m."from_user_id",
                    'to_user_id', m."to_user_id",
                    'body', m."body",
                    'is_read', m."is_read",
                    'guest_name', m."guest_name",
                    'guest_email', m."guest_email",
                    'created_at', m."created_at",
                    'image_path', m."image_path",
                    'image_paths', COALESCE((
                        SELECT jsonb_agg(i."image_path" ORDER BY i."sort_order", i."image_id")
                          FROM public."chat_message_images" AS i
                         WHERE i."message_id" = m."message_id"
                    ), '[]'::jsonb),
                    'is_unsent', m."is_unsent"
                )
                ORDER BY m."created_at", m."message_id"
            ),
            '[]'::jsonb
        )
          INTO result
          FROM (
              SELECT m.*
                FROM public."chat_messages" AS m
               WHERE ((m."from_user_id" = actor_id AND m."to_user_id" = peer_id_value)
                   OR (m."from_user_id" = peer_id_value AND m."to_user_id" = actor_id))
                 AND NOT EXISTS (
                     SELECT 1 FROM public."chat_message_hidden" AS h
                      WHERE h."message_id" = m."message_id"
                        AND h."user_id" = actor_id
                 )
               ORDER BY m."created_at", m."message_id"
               LIMIT 500
          ) AS m;
        RETURN jsonb_build_object('type', 'success', 'data', result);

    ELSIF p_action = 'send' THEN
        IF COALESCE(p_data->>'peer_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'A valid recipient is required';
        END IF;
        peer_id_value := (p_data->>'peer_id')::integer;
        IF peer_id_value = actor_id THEN
            RAISE EXCEPTION 'You cannot send a message to yourself';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public."users" AS u
             WHERE u."user_id" = peer_id_value
               AND u."is_active" = 1
               AND (actor_role <> 'Guest' OR u."user_type" = 'Admin')
        ) THEN
            RAISE EXCEPTION 'Guests may contact Admin users only';
        END IF;
        image_paths := COALESCE(p_data->'image_paths', '[]'::jsonb);
        IF jsonb_typeof(image_paths) <> 'array' THEN
            RAISE EXCEPTION 'Chat image paths must be an array';
        END IF;
        IF jsonb_array_length(image_paths) > 5 THEN
            RAISE EXCEPTION 'You can attach up to 5 images per message';
        END IF;
        IF COALESCE(btrim(p_data->>'body'), '') = '' AND jsonb_array_length(image_paths) = 0 THEN
            RAISE EXCEPTION 'Enter a message or attach an image';
        END IF;
        IF char_length(COALESCE(p_data->>'body', '')) > 4000 THEN
            RAISE EXCEPTION 'Messages must be 4000 characters or fewer';
        END IF;
        IF jsonb_array_length(image_paths) <> (
            SELECT count(DISTINCT value) FROM jsonb_array_elements_text(image_paths) AS item(value)
        ) THEN
            RAISE EXCEPTION 'Duplicate chat image paths are not allowed';
        END IF;
        FOR image_path_value IN SELECT jsonb_array_elements_text(image_paths) LOOP
            IF image_path_value !~ ('^' || auth.uid()::text || '/chat/[0-9a-f-]{36}\.(jpg|png|webp)$')
               OR NOT EXISTS (
                   SELECT 1 FROM storage.objects AS o
                    WHERE o."bucket_id" = 'mbh-chat-images'
                      AND o."name" = image_path_value
               ) THEN
                RAISE EXCEPTION 'A chat image upload was not found or is invalid';
            END IF;
        END LOOP;

        PERFORM pg_advisory_xact_lock(actor_id, 56089);
        IF (
            SELECT count(*)
              FROM public."chat_messages" AS m
             WHERE m."from_user_id" = actor_id
               AND m."created_at" > CURRENT_TIMESTAMP - interval '60 seconds'
        ) >= 30 THEN
            RAISE EXCEPTION 'Sending too fast. Slow down.';
        END IF;

        INSERT INTO public."chat_messages" ("from_user_id", "to_user_id", "body")
        VALUES (actor_id, peer_id_value, btrim(COALESCE(p_data->>'body', '')))
        RETURNING * INTO message_row;

        INSERT INTO public."chat_message_images" ("message_id", "image_path", "sort_order")
        SELECT message_row."message_id", item.value, (item.ordinality - 1)::smallint
          FROM jsonb_array_elements_text(image_paths) WITH ORDINALITY AS item(value, ordinality);

        SELECT COALESCE(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb)
          INTO result
          FROM jsonb_array_elements_text(image_paths) WITH ORDINALITY AS item(value, ordinality);

        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT peer_id_value,
               'New message',
               'You have a new message from ' ||
                   COALESCE(NULLIF(btrim(u."full_name"), ''), NULLIF(btrim(u."username"), ''), 'another user') || '.',
               'message'
          FROM public."users" AS u
         WHERE u."user_id" = actor_id;

        RETURN jsonb_build_object(
            'type', 'success',
            'data', jsonb_build_object(
                'message_id', message_row."message_id",
                'from_user_id', message_row."from_user_id",
                'to_user_id', message_row."to_user_id",
                'body', message_row."body",
                'is_read', message_row."is_read",
                'created_at', message_row."created_at",
                'image_path', message_row."image_path",
                'image_paths', result,
                'is_unsent', message_row."is_unsent"
            )
        );

    ELSIF p_action = 'remove' THEN
        IF COALESCE(p_data->>'message_id', '') !~ '^[1-9][0-9]{0,9}$'
           OR COALESCE(p_data->>'mode', '') NOT IN ('delete_for_me', 'unsend') THEN
            RAISE EXCEPTION 'Invalid message removal request';
        END IF;
        message_id_value := (p_data->>'message_id')::integer;
        mode_value := p_data->>'mode';
        SELECT m.* INTO message_row
          FROM public."chat_messages" AS m
         WHERE m."message_id" = message_id_value
           AND (m."from_user_id" = actor_id OR m."to_user_id" = actor_id)
         FOR UPDATE;
        IF message_row."message_id" IS NULL THEN
            RAISE EXCEPTION 'Message not found';
        END IF;

        IF mode_value = 'unsend' THEN
            IF message_row."from_user_id" <> actor_id THEN
                RAISE EXCEPTION 'You can only unsend your own messages';
            END IF;
            IF message_row."is_unsent" = 1 THEN
                RAISE EXCEPTION 'Message was already unsent';
            END IF;
            SELECT COALESCE(jsonb_agg(i."image_path"), '[]'::jsonb)
              INTO result
              FROM public."chat_message_images" AS i
             WHERE i."message_id" = message_id_value;
            IF message_row."image_path" IS NOT NULL THEN
                result := result || jsonb_build_array(message_row."image_path");
            END IF;
            UPDATE public."chat_messages"
               SET "body" = '', "image_path" = NULL, "is_unsent" = 1
             WHERE "message_id" = message_id_value;
            DELETE FROM public."chat_message_images"
             WHERE "message_id" = message_id_value;
            RETURN jsonb_build_object(
                'type', 'success',
                'message', 'Message removed',
                'data', jsonb_build_object('removed_image_paths', result)
            );
        END IF;

        INSERT INTO public."chat_message_hidden" ("message_id", "user_id")
        VALUES (message_id_value, actor_id)
        ON CONFLICT ("message_id", "user_id") DO NOTHING;
        RETURN jsonb_build_object('type', 'success', 'message', 'Message removed', 'data', NULL);
    END IF;

    RAISE EXCEPTION 'Invalid chat action';
END;
$$;

REVOKE ALL ON FUNCTION public.manage_my_chat(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_my_chat(text, jsonb) TO authenticated;
