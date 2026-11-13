CREATE TABLE IF NOT EXISTS public."auth_admin_guest_create_nonces" (
    "nonce" uuid PRIMARY KEY,
    "email" varchar(150) NOT NULL,
    "username" varchar(80) NOT NULL,
    "full_name" varchar(150) NOT NULL,
    "phone" varchar(40),
    "address" varchar(255),
    "birthday" date,
    "age" smallint,
    "emergency_contact_name" varchar(150),
    "emergency_contact_phone" varchar(40),
    "expires_at" timestamp with time zone NOT NULL
);

ALTER TABLE public."auth_admin_guest_create_nonces" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."auth_admin_guest_create_nonces" FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public."auth_admin_guest_create_nonces" TO service_role;

UPDATE storage.buckets
   SET file_size_limit = 10485760
 WHERE id = 'mbh-profile-pictures';

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
    linked_admin_id integer;
    guest_claim public."auth_admin_guest_create_nonces"%ROWTYPE;
    guest_nonce text;
BEGIN
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

    guest_nonce := NEW.raw_user_meta_data ->> 'mbh_admin_guest_create_nonce';
    IF guest_nonce IS NOT NULL AND guest_nonce <> '' THEN
        DELETE FROM public."auth_admin_guest_create_nonces"
         WHERE "nonce"::text = guest_nonce
           AND "email" = lower(NEW.email)
           AND "username" = NEW.raw_user_meta_data ->> 'username'
           AND "full_name" = NEW.raw_user_meta_data ->> 'full_name'
           AND COALESCE("phone", '') = COALESCE(NEW.raw_user_meta_data ->> 'phone', '')
           AND COALESCE("address", '') = COALESCE(NEW.raw_user_meta_data ->> 'address', '')
           AND COALESCE("birthday"::text, '') = COALESCE(NEW.raw_user_meta_data ->> 'birthday', '')
           AND COALESCE("age"::text, '') = COALESCE(NEW.raw_user_meta_data ->> 'age', '')
           AND COALESCE("emergency_contact_name", '') = COALESCE(NEW.raw_user_meta_data ->> 'emergency_contact_name', '')
           AND COALESCE("emergency_contact_phone", '') = COALESCE(NEW.raw_user_meta_data ->> 'emergency_contact_phone', '')
           AND "expires_at" > CURRENT_TIMESTAMP
        RETURNING * INTO guest_claim;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'The administrator guest creation claim is invalid or expired';
        END IF;

        INSERT INTO public."users" (
            "auth_user_id", "full_name", "username", "email", "phone", "address",
            "birthday", "age", "emergency_contact_name", "emergency_contact_phone",
            "user_type", "is_active"
        )
        VALUES (
            NEW.id, guest_claim."full_name", guest_claim."username", guest_claim."email",
            guest_claim."phone", guest_claim."address", guest_claim."birthday", guest_claim."age",
            guest_claim."emergency_contact_name", guest_claim."emergency_contact_phone",
            'Guest', 1
        );

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
        "auth_user_id", "full_name", "username", "email", "phone", "address",
        "birthday", "age", "emergency_contact_name", "emergency_contact_phone", "user_type"
    )
    VALUES (
        NEW.id, profile_name, profile_username, NEW.email, verified_phone,
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
