-- Link Supabase Auth identities to the existing application user IDs.
-- Existing profile records are preserved; passwords are no longer used by the app.

ALTER TABLE public."users"
    ADD COLUMN IF NOT EXISTS "auth_user_id" uuid;

ALTER TABLE public."users"
    ALTER COLUMN "password" DROP NOT NULL;

REVOKE ALL ON TABLE public."users" FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ("password") ON TABLE public."users" FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS "users_auth_user_id_key"
    ON public."users" ("auth_user_id")
    WHERE "auth_user_id" IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public."users"'::regclass
           AND conname = 'users_auth_user_id_fkey'
    ) THEN
        ALTER TABLE public."users"
            ADD CONSTRAINT "users_auth_user_id_fkey"
            FOREIGN KEY ("auth_user_id")
            REFERENCES auth.users (id)
            ON DELETE CASCADE;
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public."auth_otp_challenges" (
    "phone" varchar(40) NOT NULL,
    "purpose" text NOT NULL CHECK ("purpose" IN ('signup', 'password_reset')),
    "email" varchar(150),
    "code_hash" text NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
    "verified_at" timestamp with time zone,
    "consumed_at" timestamp with time zone,
    "reset_token_hash" text,
    "reset_token_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("phone", "purpose")
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'mbh-profile-pictures',
    'mbh-profile-pictures',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public."auth_otp_challenges" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."auth_otp_challenges" FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public."auth_otp_challenges" TO service_role;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'mbh_profile_pictures_insert_own'
    ) THEN
        CREATE POLICY "mbh_profile_pictures_insert_own"
            ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'mbh-profile-pictures'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'mbh_profile_pictures_update_own'
    ) THEN
        CREATE POLICY "mbh_profile_pictures_update_own"
            ON storage.objects FOR UPDATE TO authenticated
            USING (
                bucket_id = 'mbh-profile-pictures'
                AND (storage.foldername(name))[1] = auth.uid()::text
            )
            WITH CHECK (
                bucket_id = 'mbh-profile-pictures'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'mbh_profile_pictures_delete_own'
    ) THEN
        CREATE POLICY "mbh_profile_pictures_delete_own"
            ON storage.objects FOR DELETE TO authenticated
            USING (
                bucket_id = 'mbh-profile-pictures'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    verified_phone varchar(40);
    profile_username varchar(80);
    profile_name varchar(150);
BEGIN
    verified_phone := regexp_replace(COALESCE(
        NULLIF(NEW.raw_user_meta_data ->> 'phone', ''),
        NEW.phone
    ), '[^0-9]', '', 'g');
    IF verified_phone ~ '^09[0-9]{9}$' THEN
        verified_phone := '+63' || substring(verified_phone FROM 2);
    ELSIF verified_phone ~ '^639[0-9]{9}$' THEN
        verified_phone := '+' || verified_phone;
    ELSIF verified_phone ~ '^9[0-9]{9}$' THEN
        verified_phone := '+63' || verified_phone;
    ELSE
        RAISE EXCEPTION 'A valid Philippine phone number is required';
    END IF;
    profile_username := NULLIF(NEW.raw_user_meta_data ->> 'username', '');
    profile_name := NULLIF(NEW.raw_user_meta_data ->> 'full_name', '');

    IF NEW.email IS NULL OR verified_phone IS NULL OR profile_username IS NULL OR profile_name IS NULL THEN
        RAISE EXCEPTION 'Required profile fields are missing';
    END IF;

    UPDATE public."auth_otp_challenges"
       SET "consumed_at" = CURRENT_TIMESTAMP
     WHERE "phone" = verified_phone
       AND "purpose" = 'signup'
       AND "email" = NEW.email
       AND "verified_at" IS NOT NULL
       AND "consumed_at" IS NULL
       AND "expires_at" > CURRENT_TIMESTAMP;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'A valid verified phone challenge is required';
    END IF;

    INSERT INTO public."users" (
        "auth_user_id",
        "full_name",
        "username",
        "email",
        "phone",
        "address",
        "birthday",
        "age",
        "emergency_contact_name",
        "emergency_contact_phone",
        "user_type"
    )
    VALUES (
        NEW.id,
        profile_name,
        profile_username,
        NEW.email,
        verified_phone,
        NULLIF(NEW.raw_user_meta_data ->> 'address', ''),
        NULLIF(NEW.raw_user_meta_data ->> 'birthday', '')::date,
        NULLIF(NEW.raw_user_meta_data ->> 'age', '')::smallint,
        NULLIF(NEW.raw_user_meta_data ->> 'emergency_contact_name', ''),
        NULLIF(NEW.raw_user_meta_data ->> 'emergency_contact_phone', ''),
        'Guest'
    );

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS "on_auth_user_created_profile" ON auth.users;
CREATE TRIGGER "on_auth_user_created_profile"
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE (
    "user_id" integer,
    "username" varchar(80),
    "full_name" varchar(150),
    "email" varchar(150),
    "phone" varchar(40),
    "user_type" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT u."user_id", u."username", u."full_name", u."email", u."phone", u."user_type"
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."is_active" = 1
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT u."user_id"
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."is_active" = 1
     LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_app_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT u."user_type"
      FROM public."users" AS u
     WHERE u."auth_user_id" = auth.uid()
       AND u."is_active" = 1
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_app_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_my_profile_picture(p_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_path IS NOT NULL
       AND (storage.foldername(p_path))[1] IS DISTINCT FROM auth.uid()::text THEN
        RAISE EXCEPTION 'Profile picture path must belong to the authenticated user';
    END IF;

    UPDATE public."users"
       SET "profile_picture" = p_path
     WHERE "auth_user_id" = auth.uid()
       AND "is_active" = 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active user profile not found';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_profile_picture(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_profile_picture(text) TO authenticated;
