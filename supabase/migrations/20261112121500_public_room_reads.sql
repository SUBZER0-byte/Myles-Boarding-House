CREATE OR REPLACE FUNCTION public.get_public_rooms()
RETURNS TABLE (
    "room_id" integer,
    "room_number" varchar(40),
    "room_type" varchar(80),
    "capacity" integer,
    "monthly_rent" numeric(10,2),
    "description" text,
    "status" text,
    "image" varchar(255)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        r."room_id",
        r."room_number",
        r."room_type",
        r."capacity",
        r."monthly_rent",
        r."description",
        r."status",
        r."image"
    FROM public."rooms" AS r
    ORDER BY r."room_number" ASC;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_room_photos(p_room_id integer)
RETURNS TABLE (
    "image_id" integer,
    "filename" varchar(255),
    "caption" varchar(255),
    "sort_order" integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        photos."image_id",
        photos."filename",
        photos."caption",
        photos."sort_order"
    FROM public."room_images" AS photos
    INNER JOIN public."rooms" AS r ON r."room_id" = photos."room_id"
    WHERE p_room_id > 0
      AND photos."room_id" = p_room_id
    ORDER BY photos."sort_order" ASC, photos."image_id" ASC;
$function$;

REVOKE ALL PRIVILEGES ON TABLE public."rooms", public."room_images"
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_rooms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_room_photos(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_public_rooms() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_room_photos(integer) TO anon, authenticated;
