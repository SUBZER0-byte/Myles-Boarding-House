INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'mbh-room-images',
    'mbh-room-images',
    true,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'mbh_room_images_admin_insert'
    ) THEN
        CREATE POLICY "mbh_room_images_admin_insert"
            ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'mbh-room-images'
                AND public.current_app_user_role() = 'Admin'
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'mbh_room_images_admin_update'
    ) THEN
        CREATE POLICY "mbh_room_images_admin_update"
            ON storage.objects FOR UPDATE TO authenticated
            USING (
                bucket_id = 'mbh-room-images'
                AND public.current_app_user_role() = 'Admin'
            )
            WITH CHECK (
                bucket_id = 'mbh-room-images'
                AND public.current_app_user_role() = 'Admin'
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'mbh_room_images_admin_delete'
    ) THEN
        CREATE POLICY "mbh_room_images_admin_delete"
            ON storage.objects FOR DELETE TO authenticated
            USING (
                bucket_id = 'mbh-room-images'
                AND public.current_app_user_role() = 'Admin'
            );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_room_has_current_allocation(p_room_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public."tenants" AS t
         WHERE t."room_id" = p_room_id
           AND t."is_active" = 1
           AND t."move_in_date" <= CURRENT_DATE
           AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
    )
    OR EXISTS (
        SELECT 1
          FROM public."bookings" AS b
         WHERE b."room_id" = p_room_id
           AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
           AND COALESCE(b."move_in_date", CURRENT_DATE) <= CURRENT_DATE
           AND COALESCE(b."check_out_date", '9999-12-31'::date) > CURRENT_DATE
           AND (
               b."status" <> 'Pending'
               OR b."payment_expires_at" > CURRENT_TIMESTAMP
               OR EXISTS (
                   SELECT 1 FROM public."booking_initial_payment_requests" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."status" IN ('Submitted', 'Confirmed')
               )
               OR EXISTS (
                   SELECT 1 FROM public."payments" AS ip
                    WHERE ip."booking_id" = b."booking_id"
                      AND ip."payment_type" = CASE
                          WHEN b."payment_plan" = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                          ELSE 'Security Deposit'
                      END
                      AND ip."status" IN ('Submitted', 'Confirmed', 'Paid')
               )
           )
    )
    OR EXISTS (
        SELECT 1
          FROM public."booking_room_holds" AS h
         WHERE h."room_id" = p_room_id
           AND h."expires_at" > CURRENT_TIMESTAMP
           AND (
               h."move_in_date" IS NULL
               OR h."check_out_date" IS NULL
               OR (h."move_in_date" <= CURRENT_DATE AND h."check_out_date" > CURRENT_DATE)
           )
    )
$$;

CREATE OR REPLACE FUNCTION public.get_my_admin_rooms()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    result jsonb;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    SELECT COALESCE(jsonb_agg(room_row ORDER BY room_number), '[]'::jsonb)
      INTO result
      FROM (
          SELECT r."room_number",
                 jsonb_build_object(
                     'room_id', r."room_id",
                     'room_number', r."room_number",
                     'room_type', r."room_type",
                     'capacity', r."capacity",
                     'monthly_rent', r."monthly_rent",
                     'status', COALESCE(availability."status", r."status"),
                     'description', r."description",
                     'image', r."image",
                     'occupants', (
                         SELECT count(*)::integer
                           FROM public."tenants" AS t
                          WHERE t."room_id" = r."room_id"
                            AND t."is_active" = 1
                            AND t."move_in_date" <= CURRENT_DATE
                            AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
                     )
                 ) AS room_row
            FROM public."rooms" AS r
            LEFT JOIN LATERAL (
                SELECT a."status"
                  FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS a
                 WHERE a."room_id" = r."room_id"
            ) AS availability ON true
      ) AS rooms;

    RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_my_admin_room(
    p_room_id integer,
    p_room_number text,
    p_room_type text,
    p_capacity integer,
    p_monthly_rent numeric,
    p_status text,
    p_description text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    saved_room_id integer;
    old_capacity integer;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF NULLIF(btrim(p_room_number), '') IS NULL OR length(btrim(p_room_number)) > 40 THEN
        RAISE EXCEPTION 'Enter a valid room number';
    END IF;
    IF NULLIF(btrim(p_room_type), '') IS NULL OR length(btrim(p_room_type)) > 80 THEN
        RAISE EXCEPTION 'Enter a valid room type';
    END IF;
    IF p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 1000 THEN
        RAISE EXCEPTION 'Capacity must be between 1 and 1000';
    END IF;
    IF p_monthly_rent IS NULL OR p_monthly_rent < 0 OR p_monthly_rent > 99999999.99 THEN
        RAISE EXCEPTION 'Enter a valid monthly rent';
    END IF;
    IF p_status NOT IN ('Available', 'Reserving', 'Occupied', 'Reserved', 'Maintenance') THEN
        RAISE EXCEPTION 'Select a valid room status';
    END IF;
    IF length(COALESCE(p_description, '')) > 10000 THEN
        RAISE EXCEPTION 'Room description is too long';
    END IF;

    IF p_room_id IS NULL THEN
        INSERT INTO public."rooms" (
            "room_number", "room_type", "capacity", "monthly_rent", "status", "description"
        ) VALUES (
            btrim(p_room_number), btrim(p_room_type), p_capacity, p_monthly_rent,
            p_status, NULLIF(btrim(COALESCE(p_description, '')), '')
        )
        RETURNING "room_id" INTO saved_room_id;
    ELSE
        SELECT r."capacity"
          INTO old_capacity
          FROM public."rooms" AS r
         WHERE r."room_id" = p_room_id
         FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Room not found';
        END IF;

        IF p_capacity <> old_capacity AND (
            EXISTS (
                SELECT 1 FROM public."tenants" AS t
                 WHERE t."room_id" = p_room_id AND t."is_active" = 1
                   AND COALESCE(t."move_out_date", '9999-12-31'::date) > CURRENT_DATE
            )
            OR EXISTS (
                SELECT 1 FROM public."bookings" AS b
                 WHERE b."room_id" = p_room_id
                   AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
                   AND COALESCE(b."check_out_date", '9999-12-31'::date) > CURRENT_DATE
            )
            OR EXISTS (
                SELECT 1 FROM public."booking_room_holds" AS h
                 WHERE h."room_id" = p_room_id AND h."expires_at" > CURRENT_TIMESTAMP
            )
        ) THEN
            RAISE EXCEPTION 'Room capacity cannot be changed while tenants, bookings, or holds are assigned';
        END IF;

        IF p_status = 'Available' AND (
            public.admin_room_has_current_allocation(p_room_id)
            OR EXISTS (
                SELECT 1
                  FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS a
                 WHERE a."room_id" = p_room_id
                   AND a."status" IN ('Occupied', 'Reserved', 'Reserving')
            )
        ) THEN
            RAISE EXCEPTION 'Room status cannot be set to Available while the room is assigned or reserved';
        END IF;

        UPDATE public."rooms"
           SET "room_number" = btrim(p_room_number),
               "room_type" = btrim(p_room_type),
               "capacity" = p_capacity,
               "monthly_rent" = p_monthly_rent,
               "status" = p_status,
               "description" = NULLIF(btrim(COALESCE(p_description, '')), '')
         WHERE "room_id" = p_room_id
        RETURNING "room_id" INTO saved_room_id;
    END IF;
    RETURN saved_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_admin_room_cover(p_room_id integer, p_image_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_image_path IS NOT NULL AND (
        length(p_image_path) > 255
        OR p_image_path !~ ('^covers/' || p_room_id || '/[A-Za-z0-9-]+\.(jpg|png|webp)$')
    ) THEN
        RAISE EXCEPTION 'Invalid room image path';
    END IF;
    UPDATE public."rooms" SET "image" = p_image_path WHERE "room_id" = p_room_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room not found';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_admin_room_status(p_room_id integer, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_status NOT IN ('Available', 'Occupied', 'Reserved', 'Maintenance') THEN
        RAISE EXCEPTION 'Select a valid room status';
    END IF;
    IF p_status = 'Available' AND (
        public.admin_room_has_current_allocation(p_room_id)
        OR EXISTS (
            SELECT 1
              FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS a
             WHERE a."room_id" = p_room_id
               AND a."status" IN ('Occupied', 'Reserved', 'Reserving')
        )
    ) THEN
        RAISE EXCEPTION 'Room status cannot be set to Available while the room is assigned or reserved';
    END IF;
    UPDATE public."rooms" SET "status" = p_status WHERE "room_id" = p_room_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room not found';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_admin_room(p_room_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF EXISTS (SELECT 1 FROM public."tenants" WHERE "room_id" = p_room_id)
       OR EXISTS (SELECT 1 FROM public."bookings" WHERE "room_id" = p_room_id)
       OR EXISTS (SELECT 1 FROM public."cancellation_requests" WHERE "room_id" = p_room_id)
       OR EXISTS (SELECT 1 FROM public."room_change_requests" WHERE "requested_room_id" = p_room_id)
       OR EXISTS (SELECT 1 FROM public."room_images" WHERE "room_id" = p_room_id) THEN
        RAISE EXCEPTION 'Room cannot be deleted while tenancy, booking, cancellation, or photo records reference it';
    END IF;
    DELETE FROM public."rooms" WHERE "room_id" = p_room_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room not found';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_my_admin_room_photo(
    p_action text,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    room_id_value integer;
    image_id_value integer;
    image_path text;
    caption_value text;
    direction_value text;
    image_ids integer[];
    current_position integer;
    target_position integer;
    item_index integer;
    result jsonb;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    IF p_action = 'list' THEN
        IF jsonb_typeof(p_data->'room_id') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'A valid room ID is required';
        END IF;
        room_id_value := (p_data->>'room_id')::integer;
        SELECT COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'image_id', i."image_id",
                       'filename', i."filename",
                       'caption', i."caption",
                       'sort_order', i."sort_order"
                   ) ORDER BY i."sort_order", i."image_id"
               ), '[]'::jsonb)
          INTO result
          FROM public."room_images" AS i
         WHERE i."room_id" = room_id_value;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF p_action = 'create' THEN
        IF jsonb_typeof(p_data->'room_id') IS DISTINCT FROM 'number'
           OR jsonb_typeof(p_data->'sort_order') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'Room and sort-order values are required';
        END IF;
        room_id_value := (p_data->>'room_id')::integer;
        PERFORM 1 FROM public."rooms" WHERE "room_id" = room_id_value FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Room not found';
        END IF;
        image_path := COALESCE(p_data->>'filename', '');
        caption_value := btrim(COALESCE(p_data->>'caption', ''));
        IF image_path !~ ('^photos/' || room_id_value || '/[A-Za-z0-9-]+\.(jpg|png|webp)$')
           OR length(caption_value) > 255 THEN
            RAISE EXCEPTION 'Invalid room photo or label';
        END IF;
        IF (SELECT count(*) FROM public."room_images" WHERE "room_id" = room_id_value) >= 12 THEN
            RAISE EXCEPTION 'A room can have at most 12 photos';
        END IF;
        INSERT INTO public."room_images" ("room_id", "filename", "caption", "sort_order")
        VALUES (
            room_id_value, image_path, caption_value,
            GREATEST(0, (p_data->>'sort_order')::integer)
        )
        RETURNING "image_id" INTO image_id_value;
        RETURN jsonb_build_object('type', 'success', 'data', jsonb_build_object('image_id', image_id_value));
    END IF;

    IF p_action = 'update_caption' THEN
        image_id_value := (p_data->>'image_id')::integer;
        caption_value := btrim(COALESCE(p_data->>'caption', ''));
        IF image_id_value <= 0 OR length(caption_value) > 255 THEN
            RAISE EXCEPTION 'Invalid photo label';
        END IF;
        UPDATE public."room_images"
           SET "caption" = caption_value
         WHERE "image_id" = image_id_value;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Room photo not found';
        END IF;
        RETURN jsonb_build_object('type', 'success');
    END IF;

    IF p_action = 'move' THEN
        image_id_value := (p_data->>'image_id')::integer;
        direction_value := p_data->>'direction';
        IF image_id_value <= 0 OR direction_value NOT IN ('up', 'down') THEN
            RAISE EXCEPTION 'Invalid photo reorder request';
        END IF;
        SELECT i."room_id"
          INTO room_id_value
          FROM public."room_images" AS i
         WHERE i."image_id" = image_id_value
         FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Room photo not found';
        END IF;
        SELECT array_agg(i."image_id" ORDER BY i."sort_order", i."image_id")
          INTO image_ids
          FROM public."room_images" AS i
         WHERE i."room_id" = room_id_value;
        current_position := array_position(image_ids, image_id_value);
        target_position := current_position + CASE WHEN direction_value = 'up' THEN -1 ELSE 1 END;
        IF target_position >= 1 AND target_position <= array_length(image_ids, 1) THEN
            image_ids[current_position] := image_ids[target_position];
            image_ids[target_position] := image_id_value;
        END IF;
        item_index := 0;
        FOREACH image_id_value IN ARRAY image_ids LOOP
            UPDATE public."room_images"
               SET "sort_order" = item_index
             WHERE "image_id" = image_id_value;
            item_index := item_index + 1;
        END LOOP;
        RETURN jsonb_build_object('type', 'success');
    END IF;

    IF p_action = 'delete' THEN
        image_id_value := (p_data->>'image_id')::integer;
        IF image_id_value <= 0 THEN
            RAISE EXCEPTION 'Invalid room photo';
        END IF;
        DELETE FROM public."room_images"
         WHERE "image_id" = image_id_value
        RETURNING "filename" INTO image_path;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Room photo not found';
        END IF;
        RETURN jsonb_build_object('type', 'success', 'data', jsonb_build_object('filename', image_path));
    END IF;

    RAISE EXCEPTION 'Invalid room photo action';
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_rooms() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_room_has_current_allocation(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_my_admin_room(integer, text, text, integer, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_admin_room_cover(integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_admin_room_status(integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_my_admin_room(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manage_my_admin_room_photo(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_rooms() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_admin_room(integer, text, text, integer, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_admin_room_cover(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_admin_room_status(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_admin_room(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_my_admin_room_photo(text, jsonb) TO authenticated;
