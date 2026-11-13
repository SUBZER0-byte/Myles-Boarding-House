CREATE OR REPLACE FUNCTION public.get_public_announcements()
RETURNS TABLE (
    "announcement_id" integer,
    "title" varchar(200),
    "body" text,
    "created_at" timestamp without time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        a."announcement_id",
        a."title",
        a."body",
        a."created_at"
    FROM public."announcements" AS a
    WHERE a."is_published" = 1
    ORDER BY a."created_at" DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_house_info()
RETURNS TABLE (
    "house_address_line_1" text,
    "house_address_line_2" text,
    "house_contact_phone" text,
    "house_contact_email" text,
    "house_office_hours_line_1" text,
    "house_office_hours_line_2" text,
    "house_map_lat" text,
    "house_map_lng" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    WITH settings AS (
        SELECT
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_address_line_1') AS address_1,
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_address_line_2') AS address_2,
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_contact_phone') AS phone,
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_contact_email') AS email,
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_weekday_open_time') AS weekday_open,
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_weekday_close_time') AS weekday_close,
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_weekend_open_time') AS weekend_open,
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_weekend_close_time') AS weekend_close,
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_weekend_by_appointment') AS weekend_by_appointment,
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_map_lat') AS map_lat,
            max(s."setting_value") FILTER (WHERE s."setting_key" = 'house_map_lng') AS map_lng
        FROM public."system_settings" AS s
        WHERE s."setting_key" IN (
            'house_address_line_1',
            'house_address_line_2',
            'house_contact_phone',
            'house_contact_email',
            'house_weekday_open_time',
            'house_weekday_close_time',
            'house_weekend_open_time',
            'house_weekend_close_time',
            'house_weekend_by_appointment',
            'house_map_lat',
            'house_map_lng'
        )
    ),
    formatted AS (
        SELECT
            COALESCE(NULLIF(settings.address_1, ''), 'Lerma St., Brgy. Bañadero,') AS address_1,
            COALESCE(NULLIF(settings.address_2, ''), 'Old Albay District, Legazpi City, Albay 4500') AS address_2,
            COALESCE(NULLIF(settings.phone, ''), '+63 912 345 6789') AS phone,
            COALESCE(NULLIF(settings.email, ''), 'contact@boardinghub.com') AS email,
            CASE
                WHEN COALESCE(settings.weekday_open, '08:00') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                    THEN to_char(COALESCE(settings.weekday_open, '08:00')::time, 'FMHH12:MI AM')
                ELSE '8:00 AM'
            END AS weekday_open,
            CASE
                WHEN COALESCE(settings.weekday_close, '18:00') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                    THEN to_char(COALESCE(settings.weekday_close, '18:00')::time, 'FMHH12:MI AM')
                ELSE '6:00 PM'
            END AS weekday_close,
            CASE
                WHEN COALESCE(settings.weekend_open, '08:00') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                    THEN to_char(COALESCE(settings.weekend_open, '08:00')::time, 'FMHH12:MI AM')
                ELSE '8:00 AM'
            END AS weekend_open,
            CASE
                WHEN COALESCE(settings.weekend_close, '18:00') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                    THEN to_char(COALESCE(settings.weekend_close, '18:00')::time, 'FMHH12:MI AM')
                ELSE '6:00 PM'
            END AS weekend_close,
            lower(COALESCE(settings.weekend_by_appointment, '1')) IN ('1', 'true', 'yes') AS by_appointment,
            COALESCE(NULLIF(settings.map_lat, ''), '13.140572300741043') AS map_lat,
            COALESCE(NULLIF(settings.map_lng, ''), '123.729307594821') AS map_lng
        FROM settings
    )
    SELECT
        formatted.address_1,
        formatted.address_2,
        formatted.phone,
        formatted.email,
        'Weekdays: ' || formatted.weekday_open || ' – ' || formatted.weekday_close,
        CASE
            WHEN formatted.by_appointment THEN 'Weekends: By appointment'
            ELSE 'Weekends: ' || formatted.weekend_open || ' – ' || formatted.weekend_close
        END,
        formatted.map_lat,
        formatted.map_lng
    FROM formatted;
$function$;

REVOKE ALL ON FUNCTION public.get_public_announcements() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_house_info() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_public_announcements() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_house_info() TO anon, authenticated;
