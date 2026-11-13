INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'mbh-request-photos',
    'mbh-request-photos',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'mbh_request_photos_insert_own'
    ) THEN
        CREATE POLICY "mbh_request_photos_insert_own"
            ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'mbh-request-photos'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_tenant_request(
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
    app_tenant_id integer;
    v_request_id integer;
    request_title text;
    old_status text;
    photo_path text;
    result_data jsonb;
    request_category text;
    request_status text;
    request_reply text;
    request_priority text;
    target_user_id integer;
    urgent smallint;
    current_room_id integer;
    requested_room_id bigint;
    room_change_reason text;
BEGIN
    SELECT u."user_id", u."user_type"
      INTO app_user_id, app_user_type
      FROM public."users" AS u
     WHERE u."auth_user_id" = p_auth_user_id
       AND u."is_active" = 1;

    IF app_user_id IS NULL THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'Active account not found.');
    END IF;

    IF p_action LIKE 'admin_%' THEN
        IF app_user_type <> 'Admin' THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Administrator access is required.');
        END IF;
    ELSE
        IF app_user_type <> 'Tenant' THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Tenant access is required.');
        END IF;
        SELECT t."tenant_id"
          INTO app_tenant_id
          FROM public."tenants" AS t
         WHERE t."user_id" = app_user_id
           AND t."is_active" = 1
         ORDER BY t."tenant_id" DESC
         LIMIT 1;
        IF app_tenant_id IS NULL THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Active tenant record not found.');
        END IF;
    END IF;

    CASE p_action
        WHEN 'tenant_list_complaints' THEN
            SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item."created_at" DESC), '[]'::jsonb)
              INTO result_data
              FROM (
                  SELECT c.*,
                      COALESCE((
                          SELECT jsonb_agg(jsonb_build_object(
                              'status', h."status",
                              'changed_at', h."changed_at",
                              'changed_by_name', u."full_name"
                          ) ORDER BY h."changed_at", h."history_id")
                          FROM public."complaint_status_history" AS h
                          LEFT JOIN public."users" AS u ON u."user_id" = h."changed_by"
                          WHERE h."complaint_id" = c."complaint_id"
                      ), '[]'::jsonb) AS "status_history"
                  FROM public."complaints" AS c
                  WHERE c."tenant_id" = app_tenant_id
              ) AS item;
            RETURN jsonb_build_object('type', 'success', 'data', result_data);

        WHEN 'tenant_list_maintenance' THEN
            SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item."created_at" DESC), '[]'::jsonb)
              INTO result_data
              FROM (
                  SELECT m.*,
                      COALESCE((
                          SELECT jsonb_agg(jsonb_build_object(
                              'status', h."status",
                              'changed_at', h."changed_at",
                              'changed_by_name', u."full_name"
                          ) ORDER BY h."changed_at", h."history_id")
                          FROM public."maintenance_status_history" AS h
                          LEFT JOIN public."users" AS u ON u."user_id" = h."changed_by"
                          WHERE h."request_id" = m."request_id"
                      ), '[]'::jsonb) AS "status_history"
                  FROM public."maintenance_requests" AS m
                  WHERE m."tenant_id" = app_tenant_id
              ) AS item;
            RETURN jsonb_build_object('type', 'success', 'data', result_data);

        WHEN 'tenant_create_room_change' THEN
            IF COALESCE(p_data ->> 'requested_room_id', '') !~ '^\d{1,10}$' THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Choose a valid available room.');
            END IF;
            requested_room_id := (p_data ->> 'requested_room_id')::bigint;
            IF requested_room_id < 1 OR requested_room_id > 2147483647 THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Choose a valid available room.');
            END IF;
            room_change_reason := btrim(COALESCE(p_data ->> 'reason', ''));
            IF length(room_change_reason) > 2000 THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'The room-change reason is too long.');
            END IF;

            SELECT t."room_id"
              INTO current_room_id
              FROM public."tenants" AS t
             WHERE t."tenant_id" = app_tenant_id
               AND t."is_active" = 1
             FOR UPDATE;
            IF current_room_id IS NULL THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Your active room assignment could not be found.');
            END IF;
            IF current_room_id = requested_room_id THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'You are already assigned to this room.');
            END IF;
            PERFORM 1
              FROM public."rooms" AS r
             WHERE r."room_id" = requested_room_id
               AND r."status" = 'Available'
             FOR SHARE;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'The requested room is not available.');
            END IF;

            INSERT INTO public."room_change_requests" (
                "tenant_id", "requested_room_id", "reason", "status"
            )
            VALUES (app_tenant_id, requested_room_id, room_change_reason, 'Pending')
            RETURNING "request_id" INTO v_request_id;
            RETURN jsonb_build_object('type', 'success', 'message', 'Request submitted.', 'request_id', v_request_id);

        WHEN 'tenant_create_complaint' THEN
            request_title := btrim(COALESCE(p_data ->> 'title', ''));
            request_category := btrim(COALESCE(p_data ->> 'category', 'Other'));
            request_reply := btrim(COALESCE(p_data ->> 'description', ''));
            photo_path := NULLIF(p_data ->> 'photo_path', '');
            urgent := CASE WHEN p_data ->> 'is_urgent' = 'true' THEN 1 ELSE 0 END;
            IF request_title = '' OR length(request_title) > 180 OR request_reply = ''
               OR request_category NOT IN ('Plumbing', 'Electrical', 'Noise', 'Security', 'Sanitation', 'Internet', 'General', 'Other') THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Enter a title, description, and valid complaint category.');
            END IF;
            IF photo_path IS NOT NULL AND (
                (storage.foldername(photo_path))[1] IS DISTINCT FROM p_auth_user_id::text
                OR NOT EXISTS (
                    SELECT 1 FROM storage.objects AS object_file
                     WHERE object_file."bucket_id" = 'mbh-request-photos'
                       AND object_file."name" = photo_path
                )
            ) THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'The uploaded complaint photo is invalid.');
            END IF;

            INSERT INTO public."complaints" (
                "tenant_id", "title", "description", "category", "is_urgent", "photo_path", "status"
            )
            VALUES (app_tenant_id, request_title, request_reply, request_category, urgent, photo_path, 'Submitted')
            RETURNING "complaint_id" INTO v_request_id;

            INSERT INTO public."complaint_status_history" ("complaint_id", "status", "changed_by")
            VALUES (v_request_id, 'Submitted', app_user_id);

            SELECT t."full_name", r."room_number"
              INTO request_reply, request_priority
              FROM public."tenants" AS t
              LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
             WHERE t."tenant_id" = app_tenant_id;
            INSERT INTO public."notifications" ("user_id", "title", "message", "type")
            SELECT u."user_id",
                   CASE WHEN urgent = 1 THEN 'URGENT Tenant Complaint' ELSE 'Tenant Complaint' END,
                   COALESCE(request_reply, 'A tenant') || ' (Room ' || COALESCE(request_priority, 'Unknown room') ||
                   ') reported ' || request_category || ': ' || request_title || '.',
                   'complaint'
              FROM public."users" AS u
             WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
            RETURN jsonb_build_object(
                'type', 'success',
                'message', 'Complaint filed.',
                'complaint_id', v_request_id,
                'is_urgent', urgent = 1
            );

        WHEN 'tenant_create_maintenance' THEN
            request_title := btrim(COALESCE(p_data ->> 'title', ''));
            request_category := btrim(COALESCE(p_data ->> 'category', 'Other'));
            request_reply := btrim(COALESCE(p_data ->> 'description', ''));
            request_priority := btrim(COALESCE(p_data ->> 'priority', 'Medium'));
            photo_path := NULLIF(p_data ->> 'photo_path', '');
            IF request_title = '' OR length(request_title) > 180 OR request_reply = ''
               OR request_category NOT IN ('Plumbing', 'Electrical', 'Noise', 'Security', 'Sanitation', 'Internet', 'Other')
               OR request_priority NOT IN ('Low', 'Medium', 'High', 'Urgent') THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Enter a title, description, category, and valid priority.');
            END IF;
            IF photo_path IS NOT NULL AND (
                (storage.foldername(photo_path))[1] IS DISTINCT FROM p_auth_user_id::text
                OR NOT EXISTS (
                    SELECT 1 FROM storage.objects AS object_file
                     WHERE object_file."bucket_id" = 'mbh-request-photos'
                       AND object_file."name" = photo_path
                )
            ) THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'The uploaded maintenance photo is invalid.');
            END IF;

            INSERT INTO public."maintenance_requests" (
                "tenant_id", "title", "category", "description", "priority", "photo_path", "status"
            )
            VALUES (app_tenant_id, request_title, request_category, request_reply, request_priority, photo_path, 'Submitted')
            RETURNING "request_id" INTO v_request_id;
            INSERT INTO public."maintenance_status_history" ("request_id", "status", "changed_by")
            VALUES (v_request_id, 'Submitted', app_user_id);

            SELECT t."full_name", r."room_number"
              INTO request_reply, request_category
              FROM public."tenants" AS t
              LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
             WHERE t."tenant_id" = app_tenant_id;
            INSERT INTO public."notifications" ("user_id", "title", "message", "type")
            SELECT u."user_id",
                   'New Maintenance Request',
                   COALESCE(request_reply, 'A tenant') || ' (Room ' || COALESCE(request_category, 'Unassigned') ||
                   ') reported ' || request_priority || ' priority ' || request_title || '.',
                   'maintenance'
              FROM public."users" AS u
             WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
            RETURN jsonb_build_object('type', 'success', 'message', 'Request submitted.', 'request_id', v_request_id);

        WHEN 'tenant_cancel_complaint' THEN
            v_request_id := NULLIF(p_data ->> 'complaint_id', '')::integer;
            UPDATE public."complaints"
               SET "status" = 'Cancelled'
             WHERE "complaint_id" = v_request_id
               AND "tenant_id" = app_tenant_id
               AND "status" = 'Submitted';
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Only submitted complaints can be cancelled.');
            END IF;
            INSERT INTO public."complaint_status_history" ("complaint_id", "status", "changed_by")
            VALUES (v_request_id, 'Cancelled', app_user_id);
            RETURN jsonb_build_object('type', 'success', 'message', 'Cancelled.');

        WHEN 'tenant_cancel_maintenance' THEN
            v_request_id := NULLIF(p_data ->> 'request_id', '')::integer;
            UPDATE public."maintenance_requests"
               SET "status" = 'Cancelled'
             WHERE "request_id" = v_request_id
               AND "tenant_id" = app_tenant_id
               AND "status" = 'Submitted';
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Only submitted requests can be cancelled.');
            END IF;
            INSERT INTO public."maintenance_status_history" ("request_id", "status", "changed_by")
            VALUES (v_request_id, 'Cancelled', app_user_id);
            RETURN jsonb_build_object('type', 'success', 'message', 'Cancelled.');

        WHEN 'admin_list_complaints' THEN
            SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item."created_at" DESC), '[]'::jsonb)
              INTO result_data
              FROM (
                  SELECT c.*, t."full_name", r."room_number",
                      COALESCE((
                          SELECT jsonb_agg(jsonb_build_object(
                              'status', h."status",
                              'changed_at', h."changed_at",
                              'changed_by_name', u."full_name"
                          ) ORDER BY h."changed_at", h."history_id")
                          FROM public."complaint_status_history" AS h
                          LEFT JOIN public."users" AS u ON u."user_id" = h."changed_by"
                          WHERE h."complaint_id" = c."complaint_id"
                      ), '[]'::jsonb) AS "status_history"
                  FROM public."complaints" AS c
                  INNER JOIN public."tenants" AS t ON t."tenant_id" = c."tenant_id"
                  LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
              ) AS item;
            RETURN jsonb_build_object('type', 'success', 'data', result_data);

        WHEN 'admin_recurring_complaints' THEN
            SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item."complaint_count" DESC, item."latest_report" DESC), '[]'::jsonb)
              INTO result_data
              FROM (
                  SELECT COALESCE(NULLIF(c."category", ''), 'Other') AS "category",
                         COALESCE(r."room_number", 'Unassigned') AS "room_number",
                         count(*) AS "complaint_count",
                         max(c."created_at") AS "latest_report"
                  FROM public."complaints" AS c
                  INNER JOIN public."tenants" AS t ON t."tenant_id" = c."tenant_id"
                  LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
                  WHERE c."status" <> 'Cancelled'
                  GROUP BY COALESCE(NULLIF(c."category", ''), 'Other'), COALESCE(r."room_number", 'Unassigned')
                  HAVING count(*) >= 2
              ) AS item;
            RETURN jsonb_build_object('type', 'success', 'data', result_data);

        WHEN 'admin_list_maintenance' THEN
            SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item."created_at" DESC), '[]'::jsonb)
              INTO result_data
              FROM (
                  SELECT m.*, t."full_name", r."room_number",
                      COALESCE((
                          SELECT jsonb_agg(jsonb_build_object(
                              'status', h."status",
                              'changed_at', h."changed_at",
                              'changed_by_name', u."full_name"
                          ) ORDER BY h."changed_at", h."history_id")
                          FROM public."maintenance_status_history" AS h
                          LEFT JOIN public."users" AS u ON u."user_id" = h."changed_by"
                          WHERE h."request_id" = m."request_id"
                      ), '[]'::jsonb) AS "status_history"
                  FROM public."maintenance_requests" AS m
                  INNER JOIN public."tenants" AS t ON t."tenant_id" = m."tenant_id"
                  LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
              ) AS item;
            RETURN jsonb_build_object('type', 'success', 'data', result_data);

        WHEN 'admin_update_complaint_status' THEN
            v_request_id := NULLIF(p_data ->> 'complaint_id', '')::integer;
            request_status := btrim(COALESCE(p_data ->> 'status', ''));
            IF request_status = 'Open' THEN request_status := 'Submitted'; END IF;
            IF v_request_id IS NULL OR request_status NOT IN ('Submitted', 'Acknowledged', 'In Progress', 'Resolved', 'Cancelled') THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Invalid complaint status.');
            END IF;
            SELECT c."status", c."title", t."user_id"
              INTO old_status, request_title, target_user_id
              FROM public."complaints" AS c
              INNER JOIN public."tenants" AS t ON t."tenant_id" = c."tenant_id"
             WHERE c."complaint_id" = v_request_id
             FOR UPDATE OF c;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Complaint not found.');
            END IF;
            UPDATE public."complaints" SET "status" = request_status WHERE "complaint_id" = v_request_id;
            IF old_status IS DISTINCT FROM request_status THEN
                INSERT INTO public."complaint_status_history" ("complaint_id", "status", "changed_by")
                VALUES (v_request_id, request_status, app_user_id);
                INSERT INTO public."notifications" ("user_id", "title", "message", "type")
                VALUES (target_user_id, 'Complaint Status Update',
                    'Your complaint "' || request_title || '" is now ' || request_status || '.', 'complaint');
            END IF;
            RETURN jsonb_build_object('type', 'success', 'message', 'Updated.');

        WHEN 'admin_reply_complaint' THEN
            v_request_id := NULLIF(p_data ->> 'complaint_id', '')::integer;
            request_reply := COALESCE(p_data ->> 'reply', '');
            IF v_request_id IS NULL OR length(request_reply) > 5000 THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Enter a reply up to 5,000 characters.');
            END IF;
            SELECT c."title", t."user_id"
              INTO request_title, target_user_id
              FROM public."complaints" AS c
              INNER JOIN public."tenants" AS t ON t."tenant_id" = c."tenant_id"
             WHERE c."complaint_id" = v_request_id
             FOR UPDATE OF c;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Complaint not found.');
            END IF;
            UPDATE public."complaints"
               SET "admin_reply" = request_reply,
                   "replied_at" = CURRENT_TIMESTAMP
             WHERE "complaint_id" = v_request_id;
            INSERT INTO public."notifications" ("user_id", "title", "message", "type")
            VALUES (target_user_id, 'New Complaint Reply',
                'The admin replied to your complaint "' || request_title || '". View the complaint to read the response.',
                'complaint');
            RETURN jsonb_build_object('type', 'success', 'message', 'Reply sent.');

        WHEN 'admin_update_maintenance_status' THEN
            v_request_id := NULLIF(p_data ->> 'request_id', '')::integer;
            request_status := btrim(COALESCE(p_data ->> 'status', ''));
            IF request_status = 'Pending' THEN request_status := 'Submitted'; END IF;
            IF request_status = 'Ongoing' THEN request_status := 'In Progress'; END IF;
            IF request_status = 'Completed' THEN request_status := 'Resolved'; END IF;
            IF v_request_id IS NULL OR request_status NOT IN ('Submitted', 'Acknowledged', 'In Progress', 'Resolved', 'Cancelled') THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Invalid maintenance status.');
            END IF;
            SELECT m."status", m."title", t."user_id"
              INTO old_status, request_title, target_user_id
              FROM public."maintenance_requests" AS m
              INNER JOIN public."tenants" AS t ON t."tenant_id" = m."tenant_id"
             WHERE m."request_id" = v_request_id
             FOR UPDATE OF m;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Maintenance request not found.');
            END IF;
            UPDATE public."maintenance_requests" SET "status" = request_status WHERE "request_id" = v_request_id;
            IF old_status IS DISTINCT FROM request_status THEN
                INSERT INTO public."maintenance_status_history" ("request_id", "status", "changed_by")
                VALUES (v_request_id, request_status, app_user_id);
                INSERT INTO public."notifications" ("user_id", "title", "message", "type")
                VALUES (target_user_id, 'Maintenance Request Update',
                    'Your maintenance request "' || request_title || '" is now ' || request_status || '.', 'maintenance');
            END IF;
            RETURN jsonb_build_object('type', 'success', 'message', 'Updated.');

        WHEN 'admin_delete_complaint' THEN
            v_request_id := NULLIF(p_data ->> 'complaint_id', '')::integer;
            SELECT c."photo_path" INTO photo_path
              FROM public."complaints" AS c
             WHERE c."complaint_id" = v_request_id
             FOR UPDATE;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Complaint not found.');
            END IF;
            DELETE FROM public."complaints" WHERE "complaint_id" = v_request_id;
            RETURN jsonb_build_object('type', 'success', 'message', 'Deleted.', 'photo_path', photo_path);

        WHEN 'admin_delete_maintenance' THEN
            v_request_id := NULLIF(p_data ->> 'request_id', '')::integer;
            SELECT m."photo_path" INTO photo_path
              FROM public."maintenance_requests" AS m
             WHERE m."request_id" = v_request_id
             FOR UPDATE;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('type', 'error', 'message', 'Maintenance request not found.');
            END IF;
            DELETE FROM public."maintenance_requests" WHERE "request_id" = v_request_id;
            RETURN jsonb_build_object('type', 'success', 'message', 'Deleted.', 'photo_path', photo_path);

        ELSE
            RETURN jsonb_build_object('type', 'error', 'message', 'Invalid request action.');
    END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_tenant_request(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_tenant_request(text, uuid, jsonb) TO service_role;
