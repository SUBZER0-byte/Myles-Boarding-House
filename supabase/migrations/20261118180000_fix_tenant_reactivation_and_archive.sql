ALTER TABLE public."tenants"
    ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "tenants_idx_tenants_active_management"
    ON public."tenants" ("is_active", "full_name")
    WHERE "deleted_at" IS NULL;

CREATE OR REPLACE FUNCTION public.list_admin_tenants()
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

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'tenant_id', t."tenant_id",
                'user_id', t."user_id",
                'room_id', t."room_id",
                'full_name', t."full_name",
                'username', u."username",
                'phone', t."phone",
                'email', t."email",
                'address', u."address",
                'age', u."age",
                'birthday', u."birthday",
                'emergency_contact_name', u."emergency_contact_name",
                'emergency_contact_phone', u."emergency_contact_phone",
                'move_in_date', t."move_in_date",
                'move_out_date', t."move_out_date",
                'is_active', t."is_active",
                'room_number', r."room_number",
                'room_type', r."room_type",
                'profile_picture', u."profile_picture"
            )
            ORDER BY t."full_name"
        ),
        '[]'::jsonb
    )
      INTO result
      FROM public."tenants" AS t
      LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
      LEFT JOIN public."users" AS u ON u."user_id" = t."user_id"
     WHERE t."deleted_at" IS NULL;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_admin_tenants() TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_admin_tenant(p_tenant_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    tenant_row public."tenants"%ROWTYPE;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_tenant_id IS NULL OR p_tenant_id <= 0 THEN
        RAISE EXCEPTION 'A valid tenant ID is required';
    END IF;

    SELECT t.*
      INTO tenant_row
      FROM public."tenants" AS t
     WHERE t."tenant_id" = p_tenant_id
       AND t."deleted_at" IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tenant record not found';
    END IF;

    UPDATE public."tenants"
       SET "is_active" = 0,
           "deleted_at" = CURRENT_TIMESTAMP
     WHERE "tenant_id" = tenant_row."tenant_id";

    IF tenant_row."user_id" IS NOT NULL THEN
        UPDATE public."users"
           SET "user_type" = 'Guest'
         WHERE "user_id" = tenant_row."user_id"
           AND "user_type" IN ('Tenant', 'Guest')
           AND NOT EXISTS (
           SELECT 1
             FROM public."tenants" AS other_tenant
            WHERE other_tenant."user_id" = tenant_row."user_id"
              AND other_tenant."tenant_id" <> tenant_row."tenant_id"
              AND other_tenant."is_active" = 1
              AND other_tenant."deleted_at" IS NULL
           );
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

REVOKE ALL ON FUNCTION public.delete_admin_tenant(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_admin_tenant(integer) TO authenticated;

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
    linked_user_email text;
    room_status text;
    room_capacity integer;
    required_beds bigint;
    room_occupants bigint;
    own_booking_beds bigint;
    own_hold_beds bigint;
    other_occupancy bigint;
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
       AND t."deleted_at" IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tenant record not found';
    END IF;

    SELECT u."user_type", u."email"
      INTO linked_user_type, linked_user_email
      FROM public."users" AS u
     WHERE u."user_id" = tenant_row."user_id"
     FOR UPDATE;
    IF tenant_row."user_id" IS NOT NULL THEN
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
               AND other_tenant."deleted_at" IS NULL
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

            SELECT COALESCE(SUM(
                       CASE WHEN b."reservation_type" = 'entire_room' THEN room_capacity
                            ELSE LEAST(GREATEST(b."occupant_count", 1), room_capacity) END
                   ), 0)::bigint
              INTO own_booking_beds
              FROM public."bookings" AS b
             WHERE b."room_id" = tenant_row."room_id"
               AND b."status" IN ('Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active')
               AND b."move_in_date" < check_out_date
               AND b."check_out_date" > check_in_date
               AND (
                   lower(btrim(b."email")) = lower(btrim(COALESCE(linked_user_email, '')))
                   OR lower(btrim(b."email")) = lower(btrim(COALESCE(tenant_row."email", '')))
               )
               AND (
                   b."status" <> 'Pending'
                   OR b."payment_expires_at" > CURRENT_TIMESTAMP
                   OR EXISTS (
                       SELECT 1
                         FROM public."booking_initial_payment_requests" AS ip
                        WHERE ip."booking_id" = b."booking_id"
                          AND ip."status" IN ('Submitted', 'Confirmed')
                   )
                   OR EXISTS (
                       SELECT 1
                         FROM public."payments" AS ip
                        WHERE ip."booking_id" = b."booking_id"
                          AND ip."payment_type" = CASE
                              WHEN b."payment_plan" = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                              ELSE 'Security Deposit'
                          END
                          AND ip."status" IN ('Submitted', 'Confirmed', 'Paid')
                   )
               )
               AND NOT EXISTS (
                   SELECT 1
                     FROM public."tenants" AS other_tenant
                    WHERE other_tenant."room_id" = b."room_id"
                      AND other_tenant."is_active" = 1
                      AND other_tenant."deleted_at" IS NULL
                      AND lower(btrim(other_tenant."email")) = lower(btrim(b."email"))
                      AND other_tenant."move_in_date" < b."check_out_date"
                      AND COALESCE(other_tenant."move_out_date", '9999-12-31'::date) > b."move_in_date"
               );

            SELECT COALESCE(SUM(
                       CASE WHEN h."reservation_type" = 'entire_room' THEN room_capacity
                            ELSE LEAST(GREATEST(h."occupant_count", 1), room_capacity) END
                   ), 0)::bigint
              INTO own_hold_beds
              FROM public."booking_room_holds" AS h
             WHERE h."room_id" = tenant_row."room_id"
               AND h."expires_at" > CURRENT_TIMESTAMP
               AND (
                   h."user_id" = tenant_row."user_id"
                   OR lower(btrim(h."email")) = lower(btrim(COALESCE(linked_user_email, tenant_row."email", '')))
               )
               AND (
                   h."move_in_date" IS NULL
                   OR h."check_out_date" IS NULL
                   OR (h."move_in_date" < check_out_date AND h."check_out_date" > check_in_date)
               );

            SELECT availability."status", availability."occupants"
              INTO room_status, room_occupants
              FROM public.get_public_rooms_for_dates(check_in_date, check_out_date) AS availability
             WHERE availability."room_id" = tenant_row."room_id";
            IF room_status IS NULL OR room_status = 'Maintenance' THEN
                RAISE EXCEPTION 'This room is unavailable';
            END IF;

            other_occupancy := GREATEST(
                COALESCE(room_occupants, 0) - own_booking_beds - own_hold_beds,
                0
            );
            IF room_capacity - other_occupancy < required_beds THEN
                RAISE EXCEPTION 'The room no longer has enough availability for this tenant';
            END IF;

            DELETE FROM public."booking_room_holds" AS h
             WHERE h."room_id" = tenant_row."room_id"
               AND h."expires_at" > CURRENT_TIMESTAMP
               AND (
                   h."user_id" = tenant_row."user_id"
                   OR lower(btrim(h."email")) = lower(btrim(COALESCE(linked_user_email, tenant_row."email", '')))
               )
               AND (
                   h."move_in_date" IS NULL
                   OR h."check_out_date" IS NULL
                   OR (h."move_in_date" < check_out_date AND h."check_out_date" > check_in_date)
               );
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
