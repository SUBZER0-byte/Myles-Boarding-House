CREATE OR REPLACE FUNCTION public.manage_tenant_cancellation(
    p_action text,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    app_user_id integer;
    app_user_role text;
    tenant_row public."tenants"%ROWTYPE;
    room_row public."rooms"%ROWTYPE;
    request_row public."cancellation_requests"%ROWTYPE;
    tenant_user_id integer;
    tenant_name text;
    calculated_today date := CURRENT_DATE;
    cycle_end date;
    total_days integer;
    days_used integer;
    daily numeric(10,2);
    amount_used_value numeric(10,2);
    refund numeric(10,2);
    expires_at timestamp without time zone;
    cancellation_id_value integer;
    status_filter text;
    rejection text;
    result jsonb;
BEGIN
    SELECT u."user_id", u."user_type"
      INTO app_user_id, app_user_role
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."is_active" = 1
     LIMIT 1;

    IF app_user_id IS NULL THEN
        RETURN jsonb_build_object('type', 'error', 'message', 'Active account not found.');
    END IF;

    IF p_action LIKE 'admin_%' THEN
        IF app_user_role <> 'Admin' THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Administrator access is required.');
        END IF;
    ELSIF p_action LIKE 'tenant_%' THEN
        IF app_user_role <> 'Tenant' THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Tenant access is required.');
        END IF;
    ELSE
        RETURN jsonb_build_object('type', 'error', 'message', 'Invalid cancellation action.');
    END IF;

    IF p_action IN ('tenant_preview', 'tenant_request') THEN
        SELECT t.*
          INTO tenant_row
          FROM public."tenants" AS t
         WHERE t."user_id" = app_user_id
           AND t."is_active" = 1
         ORDER BY t."tenant_id" DESC
         LIMIT 1;

        IF tenant_row."tenant_id" IS NULL OR tenant_row."room_id" IS NULL OR tenant_row."move_in_date" IS NULL THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Tenant, room, or move-in date not found.');
        END IF;

        IF p_action = 'tenant_request' THEN
            SELECT t.*
              INTO tenant_row
              FROM public."tenants" AS t
             WHERE t."tenant_id" = tenant_row."tenant_id"
             FOR UPDATE;
            IF tenant_row."is_active" <> 1 THEN
                 RETURN jsonb_build_object('type', 'error', 'message', 'Active tenant record not found.');
            END IF;
        END IF;

        SELECT r.*
          INTO room_row
          FROM public."rooms" AS r
         WHERE r."room_id" = tenant_row."room_id";

        IF room_row."room_id" IS NULL THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Tenant room not found.');
        END IF;

        cycle_end := (tenant_row."move_in_date" + interval '1 month')::date;
        total_days := GREATEST(1, cycle_end - tenant_row."move_in_date");
        days_used := CASE
            WHEN calculated_today <= tenant_row."move_in_date" THEN 0
            WHEN calculated_today >= cycle_end THEN total_days
            ELSE calculated_today - tenant_row."move_in_date"
        END;
        daily := round(room_row."monthly_rent" / total_days, 2);
        amount_used_value := round(daily * days_used, 2);
        refund := round(GREATEST(0, room_row."monthly_rent" - amount_used_value), 2);

        IF p_action = 'tenant_preview' THEN
            RETURN jsonb_build_object(
                'type', 'success',
                'data', jsonb_build_object(
                    'full_name', tenant_row."full_name",
                    'room_number', room_row."room_number",
                    'monthly_rent', room_row."monthly_rent",
                    'daily_rate', daily,
                    'move_in_date', tenant_row."move_in_date",
                    'cancellation_date', calculated_today,
                    'calculated_at', CURRENT_TIMESTAMP,
                    'days_consumed', days_used,
                    'amount_used', amount_used_value,
                    'refund_amount', refund
                )
            );
        END IF;

        UPDATE public."cancellation_requests"
           SET "status" = 'Expired'
         WHERE "tenant_id" = tenant_row."tenant_id"
           AND "status" = 'Pending'
           AND "cancellation_expires_at" < CURRENT_TIMESTAMP;

        IF EXISTS (
            SELECT 1
              FROM public."cancellation_requests" AS cr
             WHERE cr."tenant_id" = tenant_row."tenant_id"
               AND cr."status" = 'Pending'
        ) THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'You already have a pending cancellation request.');
        END IF;

        expires_at := CASE
            WHEN calculated_today = tenant_row."move_in_date"::date
                THEN date_trunc('day', CURRENT_TIMESTAMP) + interval '1 day' - interval '1 second'
            ELSE CURRENT_TIMESTAMP + interval '45 minutes'
        END;

        INSERT INTO public."cancellation_requests" (
            "tenant_id", "room_id", "monthly_rent", "move_in_date", "cancellation_date",
            "daily_rate", "days_consumed", "amount_used", "refund_amount",
            "status", "cancellation_expires_at", "requested_by", "created_at"
        ) VALUES (
            tenant_row."tenant_id", tenant_row."room_id", room_row."monthly_rent",
            tenant_row."move_in_date", calculated_today, daily, days_used, amount_used_value,
            refund, 'Pending', expires_at, app_user_id, CURRENT_TIMESTAMP
        )
        RETURNING "cancellation_id" INTO cancellation_id_value;

        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT u."user_id",
               'Cancellation Request',
               'Tenant ' || tenant_row."full_name" || ' (Room ' || room_row."room_number" ||
                   ') has requested cancellation. Refund: ₱' || to_char(refund, 'FM9999999990.00'),
               'cancellation'
          FROM public."users" AS u
         WHERE u."user_type" = 'Admin'
           AND u."is_active" = 1;

        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (
            app_user_id, 'cancellation', 'cancellation_requested',
            'Tenant ' || tenant_row."full_name" || ' requested cancellation for Room ' ||
                room_row."room_number" || ' (ID #' || cancellation_id_value || ')'
        );

        RETURN jsonb_build_object(
            'type', 'success',
            'message', 'Cancellation request submitted',
            'data', jsonb_build_object('cancellation_id', cancellation_id_value, 'expires_at', expires_at)
        );
    END IF;

    IF p_action = 'tenant_status' THEN
        UPDATE public."cancellation_requests"
           SET "status" = 'Expired'
         WHERE "requested_by" = app_user_id
           AND "status" = 'Pending'
           AND "cancellation_expires_at" < CURRENT_TIMESTAMP;

        SELECT jsonb_build_object(
                   'cancellation_id', cr."cancellation_id",
                   'status', cr."status",
                   'cancellation_expires_at', cr."cancellation_expires_at",
                   'cancellation_date', cr."cancellation_date",
                   'days_consumed', cr."days_consumed",
                   'refund_amount', cr."refund_amount",
                   'daily_rate', cr."daily_rate",
                   'amount_used', cr."amount_used",
                   'monthly_rent', cr."monthly_rent",
                   'move_in_date', cr."move_in_date",
                   'room_number', r."room_number",
                   'rejection_reason', cr."rejection_reason"
               )
          INTO result
          FROM public."cancellation_requests" AS cr
          LEFT JOIN public."rooms" AS r ON r."room_id" = cr."room_id"
         WHERE cr."requested_by" = app_user_id
         ORDER BY cr."created_at" DESC, cr."cancellation_id" DESC
         LIMIT 1;

        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF p_action = 'tenant_withdraw' THEN
        IF jsonb_typeof(p_data->'cancellation_id') IS DISTINCT FROM 'number'
           OR p_data->>'cancellation_id' !~ '^[1-9][0-9]{0,9}$' THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'A cancellation request ID is required.');
        END IF;
        IF (p_data->>'cancellation_id')::numeric > 2147483647 THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'A cancellation request ID is required.');
        END IF;
        cancellation_id_value := (p_data->>'cancellation_id')::integer;

        UPDATE public."cancellation_requests"
           SET "status" = 'Expired'
         WHERE "requested_by" = app_user_id
           AND "status" = 'Pending'
           AND "cancellation_expires_at" < CURRENT_TIMESTAMP;

        UPDATE public."cancellation_requests"
           SET "status" = 'Withdrawn'
         WHERE "cancellation_id" = cancellation_id_value
           AND "requested_by" = app_user_id
           AND "status" = 'Pending'
           AND "cancellation_expires_at" >= CURRENT_TIMESTAMP;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Request not found or already processed.');
        END IF;

        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (app_user_id, 'cancellation', 'cancellation_withdrawn',
                'Tenant (user #' || app_user_id || ') withdrew cancellation #' || cancellation_id_value);
        RETURN jsonb_build_object('type', 'success', 'message', 'Cancellation request withdrawn');
    END IF;

    IF p_action = 'admin_list' THEN
        UPDATE public."cancellation_requests"
           SET "status" = 'Expired'
         WHERE "status" = 'Pending'
           AND "cancellation_expires_at" < CURRENT_TIMESTAMP;

        status_filter := COALESCE(p_data->>'status', 'Pending');
        IF status_filter NOT IN ('all', 'Pending', 'Approved', 'Rejected', 'Withdrawn', 'Expired') THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Invalid cancellation status filter.');
        END IF;

        SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC, cancellation_id DESC), '[]'::jsonb)
          INTO result
          FROM (
              SELECT cr."created_at", cr."cancellation_id",
                     jsonb_build_object(
                         'cancellation_id', cr."cancellation_id",
                         'tenant_id', cr."tenant_id",
                         'tenant_name', COALESCE(t."full_name", 'Unknown Tenant'),
                         'tenant_email', COALESCE(t."email", '—'),
                         'tenant_phone', COALESCE(t."phone", '—'),
                         'room_number', COALESCE(r."room_number", '—'),
                         'monthly_rent', cr."monthly_rent",
                         'move_in_date', cr."move_in_date",
                         'cancellation_date', cr."cancellation_date",
                         'daily_rate', cr."daily_rate",
                         'days_consumed', cr."days_consumed",
                         'amount_used', cr."amount_used",
                         'refund_amount', cr."refund_amount",
                         'status', cr."status",
                         'cancellation_expires_at', cr."cancellation_expires_at",
                         'rejection_reason', cr."rejection_reason",
                         'created_at', cr."created_at"
                     ) AS row_data
                FROM public."cancellation_requests" AS cr
                LEFT JOIN public."tenants" AS t ON t."tenant_id" = cr."tenant_id"
                LEFT JOIN public."rooms" AS r ON r."room_id" = cr."room_id"
               WHERE status_filter = 'all' OR cr."status" = status_filter
          ) AS rows;

        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF p_action IN ('admin_approve', 'admin_reject') THEN
        IF jsonb_typeof(p_data->'cancellation_id') IS DISTINCT FROM 'number'
           OR p_data->>'cancellation_id' !~ '^[1-9][0-9]{0,9}$' THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'A cancellation request ID is required.');
        END IF;
        IF (p_data->>'cancellation_id')::numeric > 2147483647 THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'A cancellation request ID is required.');
        END IF;
        cancellation_id_value := (p_data->>'cancellation_id')::integer;

        UPDATE public."cancellation_requests"
           SET "status" = 'Expired'
         WHERE "status" = 'Pending'
           AND "cancellation_expires_at" < CURRENT_TIMESTAMP;

        SELECT cr.*
          INTO request_row
          FROM public."cancellation_requests" AS cr
         WHERE cr."cancellation_id" = cancellation_id_value
           AND cr."status" = 'Pending'
           AND cr."cancellation_expires_at" >= CURRENT_TIMESTAMP
         FOR UPDATE;

        IF request_row."cancellation_id" IS NULL THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Request not found, expired, or already processed.');
        END IF;

        SELECT t."user_id", t."full_name"
          INTO tenant_user_id, tenant_name
          FROM public."tenants" AS t
         WHERE t."tenant_id" = request_row."tenant_id"
         FOR UPDATE;

        IF tenant_user_id IS NULL THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Tenant record not found.');
        END IF;

        SELECT r.*
          INTO room_row
          FROM public."rooms" AS r
         WHERE r."room_id" = request_row."room_id"
         FOR UPDATE;

        IF room_row."room_id" IS NULL THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Tenant room not found.');
        END IF;

        IF p_action = 'admin_approve' THEN
            UPDATE public."cancellation_requests"
               SET "status" = 'Approved', "acted_by" = app_user_id, "acted_at" = CURRENT_TIMESTAMP
             WHERE "cancellation_id" = cancellation_id_value;

            INSERT INTO public."payments" (
                "tenant_id", "amount", "due_date", "status", "description", "method", "paid_at", "created_at"
            ) VALUES (
                request_row."tenant_id", request_row."refund_amount", calculated_today, 'Paid',
                'Refund — Cancellation #' || cancellation_id_value, 'Refund', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            );

            UPDATE public."tenants"
               SET "is_active" = 0
             WHERE "tenant_id" = request_row."tenant_id";

            UPDATE public."users"
               SET "user_type" = 'Guest'
             WHERE "user_id" = tenant_user_id
               AND "user_type" = 'Tenant';

            UPDATE public."rooms" AS target
               SET "status" = availability."status"
              FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS availability
             WHERE target."room_id" = request_row."room_id"
               AND availability."room_id" = target."room_id";

            INSERT INTO public."notifications" ("user_id", "title", "message", "type")
            VALUES (
                tenant_user_id, 'Cancellation Approved',
                'Your cancellation request has been approved. A refund of ₱' ||
                    to_char(request_row."refund_amount", 'FM9999999990.00') || ' has been recorded.',
                'cancellation'
            );

            INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
            VALUES (
                app_user_id, 'cancellation', 'cancellation_approved',
                'Admin approved cancellation #' || cancellation_id_value || ' for tenant ' ||
                    tenant_name || ' (Room ' || room_row."room_number" || '); refund ₱' ||
                    to_char(request_row."refund_amount", 'FM9999999990.00')
            );

            RETURN jsonb_build_object('type', 'success', 'message', 'Cancellation approved and refund recorded');
        END IF;

        rejection := btrim(COALESCE(p_data->>'rejection_reason', ''));
        IF rejection = '' OR length(rejection) > 2000 THEN
            RETURN jsonb_build_object('type', 'error', 'message', 'Enter a rejection reason of no more than 2000 characters.');
        END IF;

        UPDATE public."cancellation_requests"
           SET "status" = 'Rejected',
               "rejection_reason" = rejection,
               "acted_by" = app_user_id,
               "acted_at" = CURRENT_TIMESTAMP
         WHERE "cancellation_id" = cancellation_id_value;

        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        VALUES (
            tenant_user_id, 'Cancellation Rejected',
            'Your cancellation request was rejected. Reason: ' || rejection,
            'cancellation'
        );

        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (
            app_user_id, 'cancellation', 'cancellation_rejected',
            'Admin rejected cancellation #' || cancellation_id_value || ' for tenant ' ||
                tenant_name || ': ' || rejection
        );

        RETURN jsonb_build_object('type', 'success', 'message', 'Cancellation rejected');
    END IF;

    RETURN jsonb_build_object('type', 'error', 'message', 'Invalid cancellation action.');
END;
$$;

REVOKE ALL ON FUNCTION public.manage_tenant_cancellation(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_tenant_cancellation(text, jsonb) TO authenticated;
