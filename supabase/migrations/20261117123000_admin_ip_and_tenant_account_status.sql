CREATE OR REPLACE FUNCTION public.capture_system_log_request_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    request_headers jsonb := '{}'::jsonb;
    ip_candidates text[];
    ip_candidate text;
BEGIN
    BEGIN
        request_headers := COALESCE(
            NULLIF(current_setting('request.headers', true), ''),
            '{}'
        )::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN
        request_headers := '{}'::jsonb;
    END;

    ip_candidates := ARRAY[
        NULLIF(btrim(NEW."ip_address"), ''),
        NULLIF(btrim(request_headers ->> 'cf-connecting-ip'), ''),
        NULLIF(btrim(request_headers ->> 'x-real-ip'), ''),
        NULLIF(btrim(split_part(COALESCE(request_headers ->> 'x-forwarded-for', ''), ',', 1)), '')
    ];
    FOREACH ip_candidate IN ARRAY ip_candidates LOOP
        IF ip_candidate IS NULL THEN
            CONTINUE;
        END IF;
        BEGIN
            NEW."ip_address" := (ip_candidate::inet)::text;
            EXIT;
        EXCEPTION WHEN invalid_text_representation THEN
            NEW."ip_address" := NULL;
        END;
    END LOOP;

    IF NULLIF(btrim(NEW."user_agent"), '') IS NULL THEN
        NEW."user_agent" := left(NULLIF(request_headers ->> 'user-agent', ''), 255);
    END IF;
    IF NULLIF(btrim(NEW."request_path"), '') IS NULL THEN
        NEW."request_path" := left(NULLIF(current_setting('request.path', true), ''), 255);
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_system_log_request_metadata() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS system_logs_capture_request_metadata ON public."system_logs";
CREATE TRIGGER system_logs_capture_request_metadata
    BEFORE INSERT ON public."system_logs"
    FOR EACH ROW
    EXECUTE FUNCTION public.capture_system_log_request_metadata();

CREATE OR REPLACE FUNCTION public.set_admin_tenant_account_status(
    p_tenant_id integer,
    p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    tenant_row public."tenants"%ROWTYPE;
    linked_user_type text;
    room_capacity integer;
    required_beds bigint;
    available_beds bigint;
    check_in_date date;
    check_out_date date;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_tenant_id IS NULL OR p_tenant_id <= 0 OR p_is_active IS NULL THEN
        RAISE EXCEPTION 'A valid tenant ID and account status are required';
    END IF;

    SELECT t.*
      INTO tenant_row
      FROM public."tenants" AS t
     WHERE t."tenant_id" = p_tenant_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tenant record not found';
    END IF;

    IF tenant_row."user_id" IS NOT NULL THEN
        SELECT u."user_type"
          INTO linked_user_type
          FROM public."users" AS u
         WHERE u."user_id" = tenant_row."user_id"
         FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'The tenant account is not linked to a user';
        END IF;
        IF linked_user_type NOT IN ('Tenant', 'Guest') THEN
            RAISE EXCEPTION 'The linked account cannot be changed from Tenant Management';
        END IF;

        IF EXISTS (
            SELECT 1
              FROM public."tenants" AS other_tenant
             WHERE other_tenant."user_id" = tenant_row."user_id"
               AND other_tenant."tenant_id" <> tenant_row."tenant_id"
               AND other_tenant."is_active" = 1
        ) THEN
            RAISE EXCEPTION 'This user has another active tenant record';
        END IF;
    END IF;

    IF p_is_active THEN
        IF tenant_row."room_id" IS NOT NULL
           AND COALESCE(tenant_row."move_out_date", '9999-12-31'::date) > CURRENT_DATE THEN
            SELECT r."capacity"
              INTO room_capacity
              FROM public."rooms" AS r
             WHERE r."room_id" = tenant_row."room_id"
             FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'The tenant room no longer exists';
            END IF;

            check_in_date := GREATEST(COALESCE(tenant_row."move_in_date", CURRENT_DATE), CURRENT_DATE);
            check_out_date := COALESCE(tenant_row."move_out_date", '9999-12-31'::date);
            IF check_out_date <= check_in_date THEN
                RAISE EXCEPTION 'The tenant stay dates are no longer valid';
            END IF;

            required_beds := CASE
                WHEN tenant_row."reservation_type" = 'entire_room' THEN room_capacity
                ELSE GREATEST(tenant_row."occupant_count", 1)
            END;
            SELECT availability."available_beds"
              INTO available_beds
              FROM public.get_public_rooms_for_dates(check_in_date, check_out_date) AS availability
             WHERE availability."room_id" = tenant_row."room_id";
            IF COALESCE(available_beds, 0) < required_beds THEN
                RAISE EXCEPTION 'The room no longer has enough availability for this tenant';
            END IF;
        END IF;

        UPDATE public."tenants"
           SET "is_active" = 1
         WHERE "tenant_id" = tenant_row."tenant_id";
        IF tenant_row."user_id" IS NOT NULL THEN
            UPDATE public."users"
               SET "user_type" = 'Tenant',
                   "is_active" = 1
             WHERE "user_id" = tenant_row."user_id";
        END IF;
    ELSE
        UPDATE public."tenants"
           SET "is_active" = 0
         WHERE "tenant_id" = tenant_row."tenant_id";
        IF tenant_row."user_id" IS NOT NULL THEN
            UPDATE public."users"
               SET "user_type" = 'Tenant',
                   "is_active" = 0
             WHERE "user_id" = tenant_row."user_id";
        END IF;
    END IF;

    IF tenant_row."room_id" IS NOT NULL THEN
        UPDATE public."rooms" AS target
           SET "status" = availability."status"
          FROM public.get_public_rooms_for_dates(CURRENT_DATE, CURRENT_DATE + 1) AS availability
         WHERE target."room_id" = tenant_row."room_id"
           AND availability."room_id" = tenant_row."room_id";
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_admin_tenant_account_status(integer, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_tenant_account_status(integer, boolean)
    TO authenticated;
