CREATE OR REPLACE FUNCTION public.get_public_rooms_for_guest_browse(
    p_check_in_date date,
    p_check_out_date date
)
RETURNS TABLE (
    "room_id" integer,
    "room_number" varchar(40),
    "room_type" varchar(80),
    "capacity" integer,
    "monthly_rent" numeric(10,2),
    "description" text,
    "status" text,
    "image" varchar(255),
    "occupants" bigint,
    "available_beds" bigint,
    "available_for_dates" boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT availability."room_id",
           availability."room_number",
           availability."room_type",
           availability."capacity",
           availability."monthly_rent",
           availability."description",
           current_room."status",
           availability."image",
           availability."occupants",
           availability."available_beds",
           availability."available_for_dates"
      FROM public.get_public_rooms_for_dates(p_check_in_date, p_check_out_date) AS availability
      JOIN public.get_public_rooms() AS current_room
        ON current_room."room_id" = availability."room_id"
     ORDER BY availability."room_number" ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_rooms_for_guest_browse(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_rooms_for_guest_browse(date, date) TO anon, authenticated;
