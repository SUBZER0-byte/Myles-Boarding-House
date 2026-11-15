INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'mbh-payment-qrs',
    'mbh-payment-qrs',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

ALTER TABLE public."gcash_qr_codes" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."gcash_qr_codes" FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_read_mbh_payment_qr(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE public.current_app_user_role()
        WHEN 'Admin' THEN EXISTS (
            SELECT 1 FROM public."gcash_qr_codes" AS qr
             WHERE qr."filename" = p_name
        )
        WHEN 'Tenant' THEN EXISTS (
            SELECT 1 FROM public."gcash_qr_codes" AS qr
             WHERE qr."filename" = p_name AND qr."amount" IS NOT NULL
        )
        WHEN 'Guest' THEN EXISTS (
            SELECT 1 FROM public."gcash_qr_codes" AS qr
             WHERE qr."filename" = p_name AND qr."amount" IS NOT NULL
        )
        ELSE false
    END
$$;

REVOKE ALL ON FUNCTION public.can_read_mbh_payment_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_mbh_payment_qr(text) TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'mbh_payment_qrs_authenticated_read'
    ) THEN
        CREATE POLICY "mbh_payment_qrs_authenticated_read"
            ON storage.objects FOR SELECT TO authenticated
            USING (
                bucket_id = 'mbh-payment-qrs'
                AND public.can_read_mbh_payment_qr(name)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'mbh_payment_qrs_admin_insert'
    ) THEN
        CREATE POLICY "mbh_payment_qrs_admin_insert"
            ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'mbh-payment-qrs'
                AND public.current_app_user_role() = 'Admin'
                AND name ~ '^gcash-qr/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'mbh_payment_qrs_admin_delete'
    ) THEN
        CREATE POLICY "mbh_payment_qrs_admin_delete"
            ON storage.objects FOR DELETE TO authenticated
            USING (
                bucket_id = 'mbh-payment-qrs'
                AND public.current_app_user_role() = 'Admin'
            );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_gcash_qrs(
    p_action text,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    actor_role text := public.current_app_user_role();
    filename_value text;
    replacement_path text;
    raw_amount numeric;
    amount_value numeric(10,2);
    result jsonb;
BEGIN
    IF actor_role IS NULL THEN
        RAISE EXCEPTION 'An active authenticated account is required';
    END IF;

    IF p_action = 'public_list' THEN
        IF actor_role NOT IN ('Admin', 'Tenant', 'Guest') THEN
            RAISE EXCEPTION 'Account access is required';
        END IF;
        SELECT COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'filename', qr."filename",
                       'amount', qr."amount",
                       'uploaded_at', extract(epoch FROM qr."created_at") * 1000,
                       'is_active', true
                   ) ORDER BY qr."amount", qr."qr_id"
               ), '[]'::jsonb)
          INTO result
          FROM public."gcash_qr_codes" AS qr
         WHERE qr."amount" IS NOT NULL
           AND EXISTS (
               SELECT 1 FROM storage.objects
                WHERE bucket_id = 'mbh-payment-qrs' AND name = qr."filename"
           );
        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF actor_role IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'Administrator access is required';
    END IF;

    IF p_action = 'admin_list' THEN
        SELECT COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'filename', qr."filename",
                       'amount', qr."amount",
                       'uploaded_at', extract(epoch FROM qr."created_at") * 1000,
                       'is_active', true
                   ) ORDER BY qr."amount", qr."qr_id"
               ), '[]'::jsonb)
          INTO result
          FROM public."gcash_qr_codes" AS qr;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    END IF;

    IF p_action = 'admin_upload' THEN
        filename_value := COALESCE(p_data->>'filename', '');
        raw_amount := (p_data->>'amount')::numeric;
        IF raw_amount IS NOT NULL AND raw_amount = round(raw_amount, 2) THEN
            amount_value := raw_amount::numeric(10,2);
        END IF;
        IF filename_value !~ '^gcash-qr/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
           OR raw_amount IS NULL OR raw_amount <= 0 OR raw_amount <> round(raw_amount, 2)
           OR amount_value IS NULL OR amount_value <= 0 THEN
            RAISE EXCEPTION 'GCash QR image or fixed amount is invalid';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM storage.objects
             WHERE bucket_id = 'mbh-payment-qrs' AND name = filename_value
        ) THEN
            RAISE EXCEPTION 'GCash QR image upload was not found';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtext('gcash-qr:' || amount_value::text));
        IF EXISTS (
            SELECT 1 FROM public."gcash_qr_codes" AS qr
             WHERE qr."amount" = amount_value
        ) THEN
            RAISE EXCEPTION 'A GCash QR already exists for this amount';
        END IF;
        INSERT INTO public."gcash_qr_codes" ("filename", "amount")
        VALUES (filename_value, amount_value);
        RETURN jsonb_build_object('type', 'success', 'data', NULL);
    END IF;

    IF p_action = 'admin_update_amount' THEN
        filename_value := COALESCE(p_data->>'filename', '');
        raw_amount := (p_data->>'amount')::numeric;
        IF raw_amount IS NOT NULL AND raw_amount = round(raw_amount, 2) THEN
            amount_value := raw_amount::numeric(10,2);
        END IF;
        IF filename_value = '' OR raw_amount IS NULL OR raw_amount <= 0
           OR raw_amount <> round(raw_amount, 2)
           OR amount_value IS NULL OR amount_value <= 0 THEN
            RAISE EXCEPTION 'GCash QR image or fixed amount is invalid';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtext('gcash-qr:' || amount_value::text));
        IF EXISTS (
            SELECT 1 FROM public."gcash_qr_codes" AS qr
             WHERE qr."amount" = amount_value
               AND qr."filename" <> filename_value
        ) THEN
            RAISE EXCEPTION 'A GCash QR already exists for this amount';
        END IF;
        UPDATE public."gcash_qr_codes"
           SET "amount" = amount_value
         WHERE "filename" = filename_value;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'GCash QR image not found';
        END IF;
        RETURN jsonb_build_object('type', 'success', 'data', NULL);
    END IF;

    IF p_action = 'admin_replace' THEN
        filename_value := COALESCE(p_data->>'filename', '');
        replacement_path := COALESCE(p_data->>'replacement_path', '');
        IF filename_value = replacement_path
           OR replacement_path !~ '^gcash-qr/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
           OR NOT EXISTS (
               SELECT 1 FROM storage.objects
                WHERE bucket_id = 'mbh-payment-qrs' AND name = replacement_path
           ) THEN
            RAISE EXCEPTION 'Replacement GCash QR image upload was not found or is invalid';
        END IF;
        UPDATE public."gcash_qr_codes"
           SET "filename" = replacement_path
         WHERE "filename" = filename_value;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'GCash QR image not found';
        END IF;
        RETURN jsonb_build_object('type', 'success', 'data', NULL);
    END IF;

    IF p_action = 'admin_delete' THEN
        filename_value := COALESCE(p_data->>'filename', '');
        DELETE FROM public."gcash_qr_codes"
         WHERE "filename" = filename_value;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'GCash QR image not found';
        END IF;
        RETURN jsonb_build_object('type', 'success', 'data', NULL);
    END IF;

    RAISE EXCEPTION 'Unsupported GCash QR action';
END;
$$;

REVOKE ALL ON FUNCTION public.manage_gcash_qrs(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_gcash_qrs(text, jsonb) TO authenticated;
