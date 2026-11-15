ALTER TABLE public."auth_otp_challenges"
    ADD COLUMN IF NOT EXISTS "auth_user_id" uuid
    REFERENCES auth.users (id)
    ON DELETE CASCADE;
