CREATE OR REPLACE FUNCTION public.get_my_admin_house_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    RETURN COALESCE(
        (
            SELECT jsonb_object_agg(s."setting_key", s."setting_value")
              FROM public."system_settings" AS s
             WHERE s."setting_key" IN (
                'house_address_line_1',
                'house_address_line_2',
                'house_contact_phone',
                'house_contact_email',
                'house_office_hours_line_1',
                'house_office_hours_line_2',
                'house_weekday_open_time',
                'house_weekday_close_time',
                'house_weekend_open_time',
                'house_weekend_close_time',
                'house_weekend_by_appointment',
                'house_map_lat',
                'house_map_lng'
             )
        ),
        '{}'::jsonb
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_my_admin_house_settings(p_settings jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    item record;
    allowed_keys constant text[] := ARRAY[
        'house_address_line_1',
        'house_address_line_2',
        'house_contact_phone',
        'house_contact_email',
        'house_office_hours_line_1',
        'house_office_hours_line_2',
        'house_weekday_open_time',
        'house_weekday_close_time',
        'house_weekend_open_time',
        'house_weekend_close_time',
        'house_weekend_by_appointment',
        'house_map_lat',
        'house_map_lng'
    ];
    setting_value text;
BEGIN
    IF public.current_app_user_role() IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;
    IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' OR p_settings = '{}'::jsonb THEN
        RAISE EXCEPTION 'House settings must be a non-empty object';
    END IF;

    FOR item IN SELECT key, value FROM jsonb_each(p_settings)
    LOOP
        IF NOT item.key = ANY(allowed_keys) OR jsonb_typeof(item.value) <> 'string' THEN
            RAISE EXCEPTION 'Unsupported house setting';
        END IF;
        setting_value := item.value #>> '{}';
        IF length(setting_value) > 500 THEN
            RAISE EXCEPTION 'House setting value is too long';
        END IF;
        IF item.key IN ('house_weekday_open_time', 'house_weekday_close_time',
                        'house_weekend_open_time', 'house_weekend_close_time')
           AND setting_value !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' THEN
            RAISE EXCEPTION 'Office hours must use HH:MM 24-hour format';
        END IF;
        IF item.key = 'house_weekend_by_appointment'
           AND lower(setting_value) NOT IN ('1', '0', 'true', 'false', 'yes', 'no') THEN
            RAISE EXCEPTION 'Weekend appointment setting is invalid';
        END IF;
        IF item.key IN ('house_map_lat', 'house_map_lng')
           AND setting_value !~ '^-?[0-9]+(?:\.[0-9]+)?$' THEN
            RAISE EXCEPTION 'Map coordinates must be valid numbers';
        END IF;
        IF item.key = 'house_map_lat'
           AND (setting_value::numeric < -90 OR setting_value::numeric > 90) THEN
            RAISE EXCEPTION 'Latitude must be between -90 and 90';
        END IF;
        IF item.key = 'house_map_lng'
           AND (setting_value::numeric < -180 OR setting_value::numeric > 180) THEN
            RAISE EXCEPTION 'Longitude must be between -180 and 180';
        END IF;

        INSERT INTO public."system_settings" ("setting_key", "setting_value")
        VALUES (item.key, setting_value)
        ON CONFLICT ("setting_key") DO UPDATE
            SET "setting_value" = EXCLUDED."setting_value";
    END LOOP;

    IF p_settings ? 'house_weekday_open_time'
       AND p_settings ? 'house_weekday_close_time'
       AND p_settings ->> 'house_weekday_open_time' >= p_settings ->> 'house_weekday_close_time' THEN
        RAISE EXCEPTION 'Weekday closing time must be later than opening time';
    END IF;
    IF lower(COALESCE(p_settings ->> 'house_weekend_by_appointment', '1')) IN ('0', 'false', 'no')
       AND p_settings ? 'house_weekend_open_time'
       AND p_settings ? 'house_weekend_close_time'
       AND p_settings ->> 'house_weekend_open_time' >= p_settings ->> 'house_weekend_close_time' THEN
        RAISE EXCEPTION 'Weekend closing time must be later than opening time';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_house_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_my_admin_house_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_house_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_admin_house_settings(jsonb) TO authenticated;
