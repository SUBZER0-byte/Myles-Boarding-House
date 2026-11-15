CREATE TABLE IF NOT EXISTS public.auth_admin_bootstrap_nonces (
    nonce text PRIMARY KEY,
    user_id integer NOT NULL
        REFERENCES public."users" ("user_id")
        ON DELETE CASCADE,
    expires_at timestamp with time zone NOT NULL
);

ALTER TABLE public.auth_admin_bootstrap_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_admin_bootstrap_nonces FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.auth_admin_bootstrap_nonces TO service_role;

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
    bootstrap_nonce text;
    bootstrap_user_id integer;
    linked_admin_id integer;
BEGIN
    bootstrap_nonce := NULLIF(NEW.raw_user_meta_data ->> 'mbh_admin_bootstrap_nonce', '');
    IF bootstrap_nonce IS NOT NULL THEN
        DELETE FROM public.auth_admin_bootstrap_nonces
         WHERE nonce = bootstrap_nonce
           AND expires_at > CURRENT_TIMESTAMP
        RETURNING user_id INTO bootstrap_user_id;

        IF bootstrap_user_id IS NULL THEN
            RAISE EXCEPTION 'Invalid or expired admin bootstrap nonce';
        END IF;

        UPDATE public."users"
           SET "auth_user_id" = NEW.id
         WHERE "user_id" = bootstrap_user_id
           AND "user_id" = 1
           AND "username" = 'admin'
           AND "user_type" = 'Admin'
           AND "auth_user_id" IS NULL
           AND lower("email") = lower(NEW.email)
        RETURNING "user_id" INTO linked_admin_id;

        IF linked_admin_id IS NULL THEN
            RAISE EXCEPTION 'No unlinked admin profile matches this Auth account';
        END IF;

        RETURN NEW;
    END IF;

    IF NEW.raw_app_meta_data ->> 'mbh_admin_bootstrap' = 'true' THEN
        UPDATE public."users"
           SET "auth_user_id" = NEW.id
         WHERE "user_id" = 1
           AND "username" = 'admin'
           AND "user_type" = 'Admin'
           AND "auth_user_id" IS NULL
           AND lower("email") = lower(NEW.email)
        RETURNING "user_id" INTO linked_admin_id;

        IF linked_admin_id IS NULL THEN
            RAISE EXCEPTION 'No unlinked admin profile matches this Auth account';
        END IF;

        RETURN NEW;
    END IF;

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

NOTIFY pgrst, 'reload schema';
