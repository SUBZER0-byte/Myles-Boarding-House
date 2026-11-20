DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM public."users"
         WHERE "gender" IS NOT NULL
           AND "gender" NOT IN ('Male', 'Female')
    ) THEN
        RAISE EXCEPTION 'Cannot restrict gender values: review existing profiles that are not Male or Female first';
    END IF;
END;
$$;

ALTER TABLE public."users"
    DROP CONSTRAINT IF EXISTS "users_gender_check";

ALTER TABLE public."users"
    ADD CONSTRAINT "users_gender_check"
    CHECK ("gender" IS NULL OR "gender" IN ('Male', 'Female'));
