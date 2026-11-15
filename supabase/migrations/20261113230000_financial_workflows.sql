-- Authenticated full-payment and refund workflows. No client can write the
-- underlying ledger or status tables directly.

ALTER TABLE public."refund_requests"
    ADD COLUMN IF NOT EXISTS "idempotency_key" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "refund_requests_user_idempotency_key"
    ON public."refund_requests" ("user_id", "idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "refund_requests_one_pending_per_payment"
    ON public."refund_requests" ("payment_id")
    WHERE "status" = 'Pending';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'mbh-financial-evidence',
    'mbh-financial-evidence',
    false,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

REVOKE ALL ON TABLE public."payments",
    public."payment_proofs",
    public."full_payment_requests",
    public."full_payment_request_items",
    public."refund_requests",
    public."gcash_transaction_references"
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_access_financial_evidence(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public."full_payment_requests" AS f
         WHERE (f."qr_path" = p_path OR f."screenshot_path" = p_path)
           AND (
               public.current_app_user_role() = 'Admin'
               OR f."user_id" = public.current_app_user_id()
           )
        UNION ALL
        SELECT 1
          FROM public."payment_proofs" AS proof
          JOIN public."payments" AS p USING ("payment_id")
          JOIN public."tenants" AS t ON t."tenant_id" = p."tenant_id"
         WHERE proof."screenshot_path" = p_path
           AND (
               public.current_app_user_role() = 'Admin'
               OR t."user_id" = public.current_app_user_id()
           )
        UNION ALL
        SELECT 1
          FROM public."refund_requests" AS rr
         WHERE (rr."screenshot_path" = p_path OR rr."transfer_screenshot_path" = p_path)
           AND (
               public.current_app_user_role() = 'Admin'
               OR rr."user_id" = public.current_app_user_id()
           )
    )
$$;

REVOKE ALL ON FUNCTION public.can_access_financial_evidence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_financial_evidence(text) TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects'
           AND policyname = 'mbh_financial_evidence_insert_own'
    ) THEN
        CREATE POLICY "mbh_financial_evidence_insert_own"
            ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'mbh-financial-evidence'
                AND (storage.foldername(name))[1] = auth.uid()::text
                AND public.current_app_user_role() IN ('Admin', 'Tenant', 'Guest')
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects'
           AND policyname = 'mbh_financial_evidence_read_authorized'
    ) THEN
        CREATE POLICY "mbh_financial_evidence_read_authorized"
            ON storage.objects FOR SELECT TO authenticated
            USING (
                bucket_id = 'mbh-financial-evidence'
                AND public.can_access_financial_evidence(name)
            );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_financial_workflows(
    p_action text,
    p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    actor_id integer;
    actor_role text;
    tenant_id_value integer;
    payment_id_value integer;
    request_id_value integer;
    refund_id_value integer;
    idempotency_key_value uuid;
    payment_row public."payments"%ROWTYPE;
    full_request public."full_payment_requests"%ROWTYPE;
    refund_row public."refund_requests"%ROWTYPE;
    result jsonb;
    proof_path text;
    qr_path text;
    reference_value text;
    note_value text;
    decision_value text;
    transfer_reference_value text;
    subtotal numeric(10,2);
    refund_total numeric(10,2);
    remaining numeric(10,2);
    has_submitted boolean;
BEGIN
    actor_id := public.current_app_user_id();
    actor_role := public.current_app_user_role();
    IF actor_id IS NULL OR actor_role IS NULL THEN
        RAISE EXCEPTION 'An active authenticated account is required';
    END IF;

    IF actor_role = 'Tenant' THEN
        SELECT t."tenant_id" INTO tenant_id_value
          FROM public."tenants" AS t
         WHERE t."user_id" = actor_id AND t."is_active" = 1
         ORDER BY t."tenant_id"
         LIMIT 1;
    END IF;

    IF p_action LIKE 'tenant_full_%' AND (actor_role <> 'Tenant' OR tenant_id_value IS NULL) THEN
        RAISE EXCEPTION 'An active tenant account is required';
    END IF;
    IF p_action LIKE 'admin_full_%' OR p_action IN ('refund_admin_list', 'refund_decide') THEN
        IF actor_role <> 'Admin' THEN
            RAISE EXCEPTION 'Administrator access is required';
        END IF;
    END IF;
    IF p_action IN ('refund_eligible', 'refund_mine', 'refund_submit')
       AND actor_role NOT IN ('Tenant', 'Guest') THEN
        RAISE EXCEPTION 'Tenant or guest access is required';
    END IF;

    IF p_action = 'tenant_full_preview' THEN
        SELECT COALESCE(sum(p."amount"), 0)::numeric(10,2)
          INTO subtotal
          FROM public."payments" AS p
         WHERE p."tenant_id" = tenant_id_value
           AND p."amount" > 0
           AND p."status" IN ('Pending', 'Overdue')
           AND (p."payment_type" IS NULL OR p."payment_type" IN ('', 'Pay Monthly', 'Pay One Month Rent'))
           AND NOT EXISTS (
               SELECT 1 FROM public."refund_requests" AS rr
                WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
           );
        SELECT EXISTS (
            SELECT 1 FROM public."payments" AS p
             WHERE p."tenant_id" = tenant_id_value
                AND p."status" = 'Submitted'
                AND (p."payment_type" IS NULL OR p."payment_type" IN ('', 'Pay Monthly', 'Pay One Month Rent'))
        ) INTO has_submitted;
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'payment_id', p."payment_id",
                    'amount', p."amount",
                    'due_date', p."due_date",
                    'description', p."description",
                    'status', p."status"
                ) ORDER BY p."due_date", p."payment_id"
            ), '[]'::jsonb
        ) INTO result
          FROM public."payments" AS p
         WHERE p."tenant_id" = tenant_id_value
           AND p."amount" > 0
           AND p."status" IN ('Pending', 'Overdue')
           AND (p."payment_type" IS NULL OR p."payment_type" IN ('', 'Pay Monthly', 'Pay One Month Rent'))
           AND NOT EXISTS (
               SELECT 1 FROM public."refund_requests" AS rr
                WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
           );
        RETURN jsonb_build_object(
            'type', 'success',
            'data', jsonb_build_object(
                'total_amount', subtotal,
                'installments', result,
                'eligible', jsonb_array_length(result) >= 2 AND NOT has_submitted
            )
        );
    ELSIF p_action = 'tenant_full_current' THEN
        SELECT f.* INTO full_request
          FROM public."full_payment_requests" AS f
         WHERE f."tenant_id" = tenant_id_value
         ORDER BY f."request_id" DESC
         LIMIT 1;
        IF full_request."request_id" IS NULL THEN
            RETURN jsonb_build_object('type', 'success', 'data', NULL);
        END IF;
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'payment_id', p."payment_id",
                    'amount', i."amount",
                    'due_date', p."due_date",
                    'description', p."description",
                    'status', p."status"
                ) ORDER BY p."due_date", p."payment_id"
            ), '[]'::jsonb
        ) INTO result
          FROM public."full_payment_request_items" AS i
          JOIN public."payments" AS p USING ("payment_id")
         WHERE i."request_id" = full_request."request_id";
        RETURN jsonb_build_object(
            'type', 'success',
            'data', jsonb_build_object(
                'request_id', full_request."request_id",
                'total_amount', full_request."total_amount",
                'status', full_request."status",
                'admin_note', full_request."admin_note",
                'reference_number', full_request."reference_number",
                'qr_path', full_request."qr_path",
                'screenshot_path', full_request."screenshot_path",
                'installments', result
            )
        );
    ELSIF p_action = 'tenant_full_request' THEN
        PERFORM 1 FROM public."tenants"
         WHERE "tenant_id" = tenant_id_value AND "is_active" = 1
         FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Active tenant record required'; END IF;
        IF EXISTS (
            SELECT 1 FROM public."full_payment_requests"
             WHERE "tenant_id" = tenant_id_value
               AND "status" IN ('Requested', 'Approved', 'Submitted')
        ) THEN
            RAISE EXCEPTION 'You already have an open full payment request';
        END IF;
        IF EXISTS (
            SELECT 1 FROM public."payments"
             WHERE "tenant_id" = tenant_id_value
               AND "status" = 'Submitted'
               AND ("payment_type" IS NULL OR "payment_type" IN ('', 'Pay Monthly', 'Pay One Month Rent'))
        ) THEN
            RAISE EXCEPTION 'A rent installment is already submitted for review';
        END IF;
        SELECT COALESCE(sum(p."amount"), 0)::numeric(10,2)
          INTO subtotal
          FROM public."payments" AS p
         WHERE p."tenant_id" = tenant_id_value
           AND p."amount" > 0 AND p."status" IN ('Pending', 'Overdue')
           AND (p."payment_type" IS NULL OR p."payment_type" IN ('', 'Pay Monthly', 'Pay One Month Rent'))
           AND NOT EXISTS (
               SELECT 1 FROM public."refund_requests" AS rr
                WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
           );
        IF (
            SELECT count(*) FROM public."payments" AS p
             WHERE p."tenant_id" = tenant_id_value
               AND p."amount" > 0 AND p."status" IN ('Pending', 'Overdue')
               AND (p."payment_type" IS NULL OR p."payment_type" IN ('', 'Pay Monthly', 'Pay One Month Rent'))
               AND NOT EXISTS (
                   SELECT 1 FROM public."refund_requests" AS rr
                    WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
               )
        ) < 2 THEN
            RAISE EXCEPTION 'At least two unpaid rent installments are required';
        END IF;
        IF subtotal <= 0 THEN RAISE EXCEPTION 'The full payment total must be greater than zero'; END IF;
        INSERT INTO public."full_payment_requests" ("tenant_id", "user_id", "total_amount", "status")
        VALUES (tenant_id_value, actor_id, subtotal, 'Requested')
        RETURNING "request_id" INTO request_id_value;
        INSERT INTO public."full_payment_request_items" ("request_id", "payment_id", "amount")
        SELECT request_id_value, p."payment_id", p."amount"
          FROM public."payments" AS p
         WHERE p."tenant_id" = tenant_id_value
           AND p."amount" > 0 AND p."status" IN ('Pending', 'Overdue')
           AND (p."payment_type" IS NULL OR p."payment_type" IN ('', 'Pay Monthly', 'Pay One Month Rent'))
           AND NOT EXISTS (
               SELECT 1 FROM public."refund_requests" AS rr
                WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
           )
         ORDER BY p."due_date", p."payment_id";
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT u."user_id", 'Full Payment Request',
               'Tenant #' || tenant_id_value || ' requested full payment of ₱' || subtotal || '.',
               'full_payment'
          FROM public."users" AS u
         WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'payment', 'full_payment_requested',
                'Tenant #' || tenant_id_value || ' requested full payment #' || request_id_value);
        RETURN jsonb_build_object(
            'type', 'success', 'message', 'Full payment request submitted',
            'data', jsonb_build_object('request_id', request_id_value, 'total_amount', subtotal)
        );
    ELSIF p_action = 'tenant_full_cancel' THEN
        IF COALESCE(p_data->>'request_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'Invalid full payment request';
        END IF;
        request_id_value := (p_data->>'request_id')::integer;
        UPDATE public."full_payment_requests"
           SET "status" = 'Cancelled', "updated_at" = CURRENT_TIMESTAMP
         WHERE "request_id" = request_id_value
           AND "tenant_id" = tenant_id_value AND "status" = 'Requested';
        IF NOT FOUND THEN RAISE EXCEPTION 'Only a requested full payment can be cancelled'; END IF;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT u."user_id", 'Full Payment Request Cancelled',
               'Tenant #' || tenant_id_value || ' cancelled full payment request #' || request_id_value || '.',
               'full_payment'
          FROM public."users" AS u
         WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'payment', 'full_payment_cancelled',
                'Tenant #' || tenant_id_value || ' cancelled full payment #' || request_id_value);
        RETURN jsonb_build_object('type', 'success', 'message', 'Full payment request cancelled', 'data', NULL);
    ELSIF p_action = 'tenant_full_submit_proof' THEN
        IF COALESCE(p_data->>'request_id', '') !~ '^[1-9][0-9]{0,9}$'
           OR COALESCE(p_data->>'idempotency_key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'A valid payment request and submission identifier are required';
        END IF;
        request_id_value := (p_data->>'request_id')::integer;
        idempotency_key_value := (p_data->>'idempotency_key')::uuid;
        reference_value := NULLIF(btrim(p_data->>'reference_number'), '');
        proof_path := NULLIF(p_data->>'screenshot_path', '');
        IF reference_value IS NULL OR length(reference_value) > 120 OR proof_path IS NULL
           OR proof_path !~ ('^' || auth.uid()::text || '/full-payment/' || request_id_value::text || '/' || idempotency_key_value::text || '\.(jpg|png|webp)$') THEN
            RAISE EXCEPTION 'Enter a valid GCash transaction number and payment screenshot';
        END IF;
        SELECT f.* INTO full_request
          FROM public."full_payment_requests" AS f
         WHERE f."request_id" = request_id_value
           AND f."tenant_id" = tenant_id_value
         FOR UPDATE;
        IF full_request."request_id" IS NULL THEN RAISE EXCEPTION 'Full payment request not found'; END IF;
        IF full_request."status" = 'Submitted'
           AND full_request."reference_number" = reference_value
           AND full_request."screenshot_path" = proof_path THEN
            RETURN jsonb_build_object('type', 'success', 'message', 'Payment proof already submitted', 'data', NULL);
        END IF;
        IF full_request."status" <> 'Approved' THEN
            RAISE EXCEPTION 'This full payment request is not awaiting proof';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM storage.objects
             WHERE bucket_id = 'mbh-financial-evidence' AND name = proof_path
        ) THEN
            RAISE EXCEPTION 'Payment proof upload was not found';
        END IF;
        INSERT INTO public."gcash_transaction_references" ("reference_number")
        VALUES (reference_value)
        ON CONFLICT ("reference_number") DO NOTHING;
        IF NOT FOUND THEN RAISE EXCEPTION 'This GCash reference has already been submitted'; END IF;
        UPDATE public."full_payment_requests"
           SET "status" = 'Submitted',
               "reference_number" = reference_value,
               "screenshot_path" = proof_path,
               "submitted_at" = CURRENT_TIMESTAMP,
               "updated_at" = CURRENT_TIMESTAMP
         WHERE "request_id" = request_id_value;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT u."user_id", 'Full Payment Proof Submitted',
               'Tenant #' || tenant_id_value || ' submitted proof for full payment request #' || request_id_value || '.',
               'full_payment'
          FROM public."users" AS u
         WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'payment', 'full_payment_proof_submitted',
                'Tenant #' || tenant_id_value || ' submitted proof for full payment #' || request_id_value);
        RETURN jsonb_build_object('type', 'success', 'message', 'Full payment proof submitted for admin review', 'data', NULL);
    ELSIF p_action = 'admin_full_list' THEN
        IF p_data->>'status' IS NOT NULL
           AND p_data->>'status' NOT IN ('Requested', 'Approved', 'Rejected', 'Submitted', 'Confirmed', 'Cancelled') THEN
            RAISE EXCEPTION 'Invalid request status';
        END IF;
        SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC, request_id DESC), '[]'::jsonb)
          INTO result
          FROM (
              SELECT f."created_at", f."request_id",
                     jsonb_build_object(
                         'request_id', f."request_id",
                         'tenant_id', f."tenant_id",
                         'user_id', f."user_id",
                         'total_amount', f."total_amount",
                         'status', f."status",
                         'admin_note', f."admin_note",
                         'reference_number', f."reference_number",
                         'qr_path', f."qr_path",
                         'screenshot_path', f."screenshot_path",
                         'has_screenshot', f."screenshot_path" IS NOT NULL,
                         'created_at', f."created_at",
                         'full_name', t."full_name",
                         'email', t."email",
                         'phone', t."phone",
                         'room_number', r."room_number",
                         'installment_count', (
                             SELECT count(*) FROM public."full_payment_request_items" AS i
                              WHERE i."request_id" = f."request_id"
                         ),
                         'installments', (
                             SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                 'payment_id', p."payment_id", 'amount', i."amount",
                                 'due_date', p."due_date", 'description', p."description",
                                 'payment_status', p."status"
                             ) ORDER BY p."due_date", p."payment_id"), '[]'::jsonb)
                               FROM public."full_payment_request_items" AS i
                               JOIN public."payments" AS p USING ("payment_id")
                              WHERE i."request_id" = f."request_id"
                         )
                     ) AS row_data
                FROM public."full_payment_requests" AS f
                JOIN public."tenants" AS t ON t."tenant_id" = f."tenant_id"
                LEFT JOIN public."rooms" AS r ON r."room_id" = t."room_id"
               WHERE (p_data->>'status' IS NULL OR f."status" = p_data->>'status')
                 AND (
                     NULLIF(btrim(p_data->>'search'), '') IS NULL
                     OR t."full_name" ILIKE '%' || btrim(p_data->>'search') || '%'
                     OR COALESCE(t."email", '') ILIKE '%' || btrim(p_data->>'search') || '%'
                     OR COALESCE(r."room_number", '') ILIKE '%' || btrim(p_data->>'search') || '%'
                 )
          ) AS rows;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    ELSIF p_action = 'admin_full_approve' THEN
        IF COALESCE(p_data->>'request_id', '') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'Select a request'; END IF;
        request_id_value := (p_data->>'request_id')::integer;
        qr_path := NULLIF(p_data->>'qr_path', '');
        note_value := NULLIF(btrim(p_data->>'admin_note'), '');
        IF length(COALESCE(note_value, '')) > 2000 OR qr_path IS NULL
           OR qr_path !~ ('^' || auth.uid()::text || '/full-payment-qr/' || request_id_value::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') THEN
            RAISE EXCEPTION 'Select a request and upload a valid GCash QR image';
        END IF;
        SELECT f.* INTO full_request
          FROM public."full_payment_requests" AS f
         WHERE f."request_id" = request_id_value
         FOR UPDATE;
        IF full_request."request_id" IS NULL OR full_request."status" <> 'Requested' THEN
            RAISE EXCEPTION 'This request is no longer awaiting approval';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM storage.objects
             WHERE bucket_id = 'mbh-financial-evidence' AND name = qr_path
        ) THEN RAISE EXCEPTION 'GCash QR upload was not found'; END IF;
        SELECT COALESCE(sum(i."amount"), 0)::numeric(10,2)
          INTO subtotal
          FROM public."full_payment_request_items" AS i
         WHERE i."request_id" = request_id_value;
        IF (SELECT count(*) FROM public."full_payment_request_items" WHERE "request_id" = request_id_value) < 2
           OR subtotal <> full_request."total_amount"
           OR EXISTS (
               SELECT 1
                 FROM public."full_payment_request_items" AS i
                 JOIN public."payments" AS p USING ("payment_id")
                WHERE i."request_id" = request_id_value
                  AND (
                      p."status" NOT IN ('Pending', 'Overdue')
                      OR p."amount" <> i."amount"
                      OR p."amount" <= 0
                      OR (p."payment_type" IS NOT NULL AND p."payment_type" NOT IN ('', 'Pay Monthly', 'Pay One Month Rent'))
                      OR EXISTS (
                          SELECT 1 FROM public."refund_requests" AS rr
                           WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
                      )
                  )
           ) THEN
            RAISE EXCEPTION 'The covered installments changed; reject this request and ask the tenant to submit a new one';
        END IF;
        UPDATE public."full_payment_requests"
           SET "status" = 'Approved', "qr_path" = qr_path,
               "admin_note" = note_value, "approved_by" = actor_id,
               "approved_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
         WHERE "request_id" = request_id_value;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        VALUES (
            full_request."user_id", 'Full Payment Approved',
            'Your full payment request #' || request_id_value || ' was approved. Pay the fixed amount of ₱' || full_request."total_amount" || ' using the GCash QR in your Payments page.',
            'full_payment'
        );
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'payment', 'full_payment_approved', 'Admin approved full payment #' || request_id_value);
        RETURN jsonb_build_object('type', 'success', 'message', 'Full payment request approved', 'data', NULL);
    ELSIF p_action = 'admin_full_reject' THEN
        IF COALESCE(p_data->>'request_id', '') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'Select a request'; END IF;
        request_id_value := (p_data->>'request_id')::integer;
        note_value := NULLIF(btrim(p_data->>'admin_note'), '');
        IF note_value IS NULL OR length(note_value) > 2000 THEN RAISE EXCEPTION 'A note is required'; END IF;
        SELECT f.* INTO full_request FROM public."full_payment_requests" AS f
         WHERE f."request_id" = request_id_value FOR UPDATE;
        IF full_request."request_id" IS NULL OR full_request."status" <> 'Requested' THEN
            RAISE EXCEPTION 'This request is no longer awaiting a decision';
        END IF;
        UPDATE public."full_payment_requests"
           SET "status" = 'Rejected', "admin_note" = note_value, "updated_at" = CURRENT_TIMESTAMP
         WHERE "request_id" = request_id_value;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        VALUES (full_request."user_id", 'Full Payment Request Rejected',
                'Your full payment request #' || request_id_value || ' was rejected. Admin note: ' || note_value,
                'full_payment');
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'payment', 'full_payment_rejected', 'Admin rejected full payment #' || request_id_value);
        RETURN jsonb_build_object('type', 'success', 'message', 'Full payment request rejected', 'data', NULL);
    ELSIF p_action IN ('admin_full_confirm', 'admin_full_reject_proof') THEN
        IF COALESCE(p_data->>'request_id', '') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'Select a request'; END IF;
        request_id_value := (p_data->>'request_id')::integer;
        note_value := NULLIF(btrim(p_data->>'admin_note'), '');
        SELECT f.* INTO full_request FROM public."full_payment_requests" AS f
         WHERE f."request_id" = request_id_value FOR UPDATE;
        IF full_request."request_id" IS NULL OR full_request."status" <> 'Submitted'
           OR full_request."screenshot_path" IS NULL OR full_request."reference_number" IS NULL THEN
            RAISE EXCEPTION 'This request has no payment proof awaiting verification';
        END IF;
        SELECT COALESCE(sum(i."amount"), 0)::numeric(10,2)
          INTO subtotal
          FROM public."full_payment_request_items" AS i
         WHERE i."request_id" = request_id_value;
        IF (SELECT count(*) FROM public."full_payment_request_items" WHERE "request_id" = request_id_value) < 2
           OR subtotal <> full_request."total_amount"
           OR EXISTS (
               SELECT 1
                 FROM public."full_payment_request_items" AS i
                 JOIN public."payments" AS p USING ("payment_id")
                WHERE i."request_id" = request_id_value
                  AND (
                      p."status" NOT IN ('Pending', 'Overdue')
                      OR p."amount" <> i."amount"
                      OR p."amount" <= 0
                      OR (p."payment_type" IS NOT NULL AND p."payment_type" NOT IN ('', 'Pay Monthly', 'Pay One Month Rent'))
                      OR EXISTS (
                          SELECT 1 FROM public."refund_requests" AS rr
                           WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
                      )
                  )
           ) THEN
            RAISE EXCEPTION 'A covered installment changed; review the request before confirming';
        END IF;
        IF p_action = 'admin_full_confirm' THEN
            INSERT INTO public."payment_proofs" ("payment_id", "screenshot_path")
            SELECT i."payment_id", full_request."screenshot_path"
              FROM public."full_payment_request_items" AS i
             WHERE i."request_id" = request_id_value
            ON CONFLICT ("payment_id") DO UPDATE
                SET "screenshot_path" = EXCLUDED."screenshot_path",
                    "uploaded_at" = CURRENT_TIMESTAMP;
            UPDATE public."payments" AS p
               SET "status" = 'Paid', "method" = 'GCash',
                   "reference_number" = full_request."reference_number",
                   "confirmed_by" = actor_id, "confirmation_date" = CURRENT_TIMESTAMP,
                   "paid_at" = CURRENT_TIMESTAMP
              FROM public."full_payment_request_items" AS i
             WHERE i."request_id" = request_id_value
               AND p."payment_id" = i."payment_id";
            UPDATE public."full_payment_requests"
               SET "status" = 'Confirmed', "confirmed_by" = actor_id,
                   "confirmed_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
             WHERE "request_id" = request_id_value;
            INSERT INTO public."notifications" ("user_id", "title", "message", "type")
            VALUES (full_request."user_id", 'Full Payment Confirmed',
                    'Your full payment request #' || request_id_value || ' was confirmed. All covered rent installments are paid.',
                    'full_payment');
            INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
            VALUES (actor_id, 'payment', 'full_payment_confirmed', 'Admin confirmed full payment #' || request_id_value);
            RETURN jsonb_build_object('type', 'success', 'message', 'Full payment confirmed', 'data', NULL);
        END IF;
        IF note_value IS NULL OR length(note_value) > 2000 THEN RAISE EXCEPTION 'A note is required'; END IF;
        UPDATE public."full_payment_requests"
           SET "status" = 'Approved', "reference_number" = NULL, "screenshot_path" = NULL,
               "submitted_at" = NULL, "admin_note" = note_value, "updated_at" = CURRENT_TIMESTAMP
         WHERE "request_id" = request_id_value;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        VALUES (full_request."user_id", 'Full Payment Proof Needs Correction',
                'Your proof for full payment request #' || request_id_value || ' was rejected. Admin note: ' || note_value || ' You may upload corrected proof.',
                'full_payment');
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'payment', 'full_payment_proof_rejected', 'Admin rejected proof for full payment #' || request_id_value);
        RETURN jsonb_build_object('type', 'success', 'message', 'Full payment proof rejected', 'data', NULL);
    ELSIF p_action = 'refund_eligible' THEN
        IF p_data ? 'payment_id' AND COALESCE(p_data->>'payment_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'Invalid payment ID';
        END IF;
        IF p_data ? 'booking_id' AND COALESCE(p_data->>'booking_id', '') !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'Invalid booking ID';
        END IF;
        SELECT COALESCE(jsonb_agg(row_data ORDER BY paid_at DESC NULLS LAST, payment_id DESC), '[]'::jsonb)
          INTO result
          FROM (
              SELECT p."paid_at", p."payment_id",
                     jsonb_build_object(
                         'payment_id', p."payment_id", 'booking_id', p."booking_id",
                         'amount', p."amount", 'remaining_amount', p."amount" - COALESCE((
                             SELECT sum(rr."refund_amount") FROM public."refund_requests" AS rr
                              WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
                         ), 0),
                         'method', p."method", 'reference_number', p."reference_number",
                         'description', p."description", 'due_date', p."due_date",
                         'has_pending_request', EXISTS (
                             SELECT 1 FROM public."refund_requests" AS rr
                              WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Pending'
                         )
                     ) AS row_data
                FROM public."payments" AS p
                LEFT JOIN public."tenants" AS t ON t."tenant_id" = p."tenant_id"
                LEFT JOIN public."bookings" AS b ON b."booking_id" = p."booking_id"
               WHERE p."status" IN ('Confirmed', 'Paid')
                 AND (
                     (actor_role = 'Tenant' AND t."user_id" = actor_id AND t."is_active" = 1)
                     OR (actor_role = 'Guest' AND p."booking_id" IS NOT NULL AND (
                         b."guest_user_id" = actor_id OR EXISTS (
                             SELECT 1 FROM public."users" AS u
                              WHERE u."user_id" = actor_id
                                AND lower(trim(u."email")) = lower(trim(b."email"))
                         )
                     ))
                 )
                 AND (actor_role <> 'Tenant' OR (
                     p."due_date" IS NOT NULL
                     AND CURRENT_DATE < LEAST(
                         (p."due_date" + interval '1 month')::date,
                         COALESCE(b."check_out_date", t."move_out_date", (p."due_date" + interval '1 month')::date)
                     )
                 ))
                 AND (NULLIF(p_data->>'payment_id', '') IS NULL OR p."payment_id" = (p_data->>'payment_id')::integer)
                 AND (NULLIF(p_data->>'booking_id', '') IS NULL OR p."booking_id" = (p_data->>'booking_id')::integer)
                 AND p."amount" > COALESCE((
                     SELECT sum(rr."refund_amount") FROM public."refund_requests" AS rr
                      WHERE rr."payment_id" = p."payment_id" AND rr."status" = 'Approved'
                 ), 0)
          ) AS eligible;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    ELSIF p_action = 'refund_mine' THEN
        IF actor_role NOT IN ('Tenant', 'Guest') THEN RAISE EXCEPTION 'Tenant or guest access is required'; END IF;
        SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
          INTO result
          FROM (
              SELECT rr."created_at",
                     jsonb_build_object(
                         'refund_id', rr."refund_id", 'payment_id', rr."payment_id",
                         'refund_amount', rr."refund_amount", 'gcash_account_name', rr."gcash_account_name",
                         'gcash_number', rr."gcash_number", 'transaction_reference', rr."transaction_reference",
                         'screenshot_path', rr."screenshot_path",
                         'transfer_reference', rr."transfer_reference",
                         'transfer_screenshot_path', rr."transfer_screenshot_path",
                         'reason', rr."reason", 'status', rr."status",
                         'admin_note', rr."admin_note", 'created_at', rr."created_at",
                         'description', p."description", 'payment_amount', p."amount",
                         'method', p."method", 'reference_number', p."reference_number",
                         'booking_id', p."booking_id", 'due_date', p."due_date"
                     ) AS row_data
                FROM public."refund_requests" AS rr
                JOIN public."payments" AS p USING ("payment_id")
               WHERE rr."user_id" = actor_id
          ) AS mine;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    ELSIF p_action = 'refund_submit' THEN
        IF COALESCE(p_data->>'payment_id', '') !~ '^[1-9][0-9]{0,9}$'
           OR COALESCE(p_data->>'idempotency_key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'A valid payment and request identifier are required';
        END IF;
        payment_id_value := (p_data->>'payment_id')::integer;
        idempotency_key_value := (p_data->>'idempotency_key')::uuid;
        SELECT rr.* INTO refund_row FROM public."refund_requests" AS rr
         WHERE rr."user_id" = actor_id AND rr."idempotency_key" = idempotency_key_value;
        IF refund_row."refund_id" IS NOT NULL THEN
            IF refund_row."payment_id" = payment_id_value THEN
                RETURN jsonb_build_object('type', 'success', 'message', 'Refund request already submitted',
                    'data', jsonb_build_object('refund_id', refund_row."refund_id", 'refund_amount', refund_row."refund_amount"));
            END IF;
            RAISE EXCEPTION 'Refund request identifier was already used';
        END IF;
        reference_value := NULLIF(btrim(p_data->>'transaction_reference'), '');
        proof_path := NULLIF(p_data->>'screenshot_path', '');
        IF length(COALESCE(p_data->>'gcash_account_name', '')) > 120
           OR btrim(COALESCE(p_data->>'gcash_account_name', '')) = ''
           OR length(COALESCE(p_data->>'gcash_number', '')) > 30
           OR btrim(COALESCE(p_data->>'gcash_number', '')) = ''
           OR length(COALESCE(reference_value, '')) > 120
           OR length(COALESCE(p_data->>'reason', '')) > 2000 THEN
            RAISE EXCEPTION 'Enter a valid GCash account name and number';
        END IF;
        IF proof_path IS NOT NULL
           AND proof_path !~ ('^' || auth.uid()::text || '/refund/' || payment_id_value::text || '/' || idempotency_key_value::text || '\.(jpg|png|webp)$') THEN
            RAISE EXCEPTION 'Invalid refund screenshot path';
        END IF;
        SELECT p.* INTO payment_row
          FROM public."payments" AS p
          LEFT JOIN public."tenants" AS t ON t."tenant_id" = p."tenant_id"
          LEFT JOIN public."bookings" AS b ON b."booking_id" = p."booking_id"
         WHERE p."payment_id" = payment_id_value
           AND p."status" IN ('Confirmed', 'Paid')
           AND (
               (actor_role = 'Tenant' AND t."user_id" = actor_id AND t."is_active" = 1)
               OR (actor_role = 'Guest' AND p."booking_id" IS NOT NULL AND (
                   b."guest_user_id" = actor_id OR EXISTS (
                       SELECT 1 FROM public."users" AS u
                        WHERE u."user_id" = actor_id
                          AND lower(trim(u."email")) = lower(trim(b."email"))
                   )
               ))
           )
           AND (actor_role <> 'Tenant' OR (
               p."due_date" IS NOT NULL
               AND CURRENT_DATE < LEAST(
                   (p."due_date" + interval '1 month')::date,
                   COALESCE(b."check_out_date", t."move_out_date", (p."due_date" + interval '1 month')::date)
               )
           ))
         FOR UPDATE OF p;
        IF payment_row."payment_id" IS NULL THEN RAISE EXCEPTION 'Paid payment not found or refund period ended'; END IF;
        IF reference_value IS NULL AND NULLIF(btrim(payment_row."reference_number"), '') IS NULL AND proof_path IS NULL THEN
            RAISE EXCEPTION 'Provide a transaction number or GCash payment screenshot';
        END IF;
        IF proof_path IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM storage.objects
             WHERE bucket_id = 'mbh-financial-evidence' AND name = proof_path
        ) THEN RAISE EXCEPTION 'Refund screenshot upload was not found'; END IF;
        IF EXISTS (
            SELECT 1 FROM public."refund_requests"
             WHERE "payment_id" = payment_id_value AND "status" = 'Pending'
        ) THEN RAISE EXCEPTION 'A refund request for this payment is already pending'; END IF;
        SELECT COALESCE(sum("refund_amount"), 0)::numeric(10,2)
          INTO refund_total
          FROM public."refund_requests"
         WHERE "payment_id" = payment_id_value AND "status" = 'Approved';
        remaining := round(payment_row."amount" - refund_total, 2);
        IF remaining <= 0 THEN RAISE EXCEPTION 'This payment has no remaining refundable amount'; END IF;
        INSERT INTO public."refund_requests" (
            "payment_id", "user_id", "refund_amount", "gcash_account_name", "gcash_number",
            "transaction_reference", "screenshot_path", "reason", "idempotency_key"
        ) VALUES (
            payment_id_value, actor_id, remaining,
            btrim(p_data->>'gcash_account_name'), btrim(p_data->>'gcash_number'),
            reference_value, proof_path, NULLIF(btrim(p_data->>'reason'), ''), idempotency_key_value
        )
        RETURNING "refund_id" INTO refund_id_value;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        SELECT u."user_id", 'Refund Request',
               'A refund request for payment #' || payment_id_value || ' is awaiting review.',
               'refund'
          FROM public."users" AS u
         WHERE u."user_type" = 'Admin' AND u."is_active" = 1;
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'payment', 'refund_requested', 'User #' || actor_id || ' requested a refund for payment #' || payment_id_value);
        RETURN jsonb_build_object(
            'type', 'success', 'message', 'Refund request submitted for admin review',
            'data', jsonb_build_object('refund_id', refund_id_value, 'refund_amount', remaining)
        );
    ELSIF p_action = 'refund_admin_list' THEN
        SELECT COALESCE(jsonb_agg(row_data ORDER BY pending_rank, created_at DESC), '[]'::jsonb)
          INTO result
          FROM (
              SELECT rr."created_at", CASE WHEN rr."status" = 'Pending' THEN 0 ELSE 1 END AS pending_rank,
                     jsonb_build_object(
                         'refund_id', rr."refund_id", 'payment_id', rr."payment_id", 'user_id', rr."user_id",
                         'refund_amount', rr."refund_amount", 'gcash_account_name', rr."gcash_account_name",
                         'gcash_number', rr."gcash_number", 'transaction_reference', rr."transaction_reference",
                         'screenshot_path', rr."screenshot_path", 'transfer_reference', rr."transfer_reference",
                         'transfer_screenshot_path', rr."transfer_screenshot_path",
                         'reason', rr."reason", 'status', rr."status", 'admin_note', rr."admin_note",
                         'created_at', rr."created_at", 'acted_at', rr."acted_at",
                         'payment_amount', p."amount", 'method', p."method",
                         'reference_number', p."reference_number", 'description', p."description",
                         'payment_type', p."payment_type", 'booking_id', p."booking_id",
                         'due_date', p."due_date", 'payer_name', COALESCE(b."full_name", t."full_name"),
                         'payer_email', COALESCE(b."email", t."email", u."email")
                     ) AS row_data
                FROM public."refund_requests" AS rr
                JOIN public."payments" AS p USING ("payment_id")
                JOIN public."users" AS u ON u."user_id" = rr."user_id"
                LEFT JOIN public."bookings" AS b ON b."booking_id" = p."booking_id"
                LEFT JOIN public."tenants" AS t ON t."tenant_id" = p."tenant_id"
          ) AS admin_rows;
        RETURN jsonb_build_object('type', 'success', 'data', result);
    ELSIF p_action = 'refund_decide' THEN
        IF COALESCE(p_data->>'refund_id', '') !~ '^[1-9][0-9]{0,9}$'
           OR COALESCE(p_data->>'decision', '') NOT IN ('Approved', 'Rejected') THEN
            RAISE EXCEPTION 'Invalid refund decision';
        END IF;
        refund_id_value := (p_data->>'refund_id')::integer;
        decision_value := p_data->>'decision';
        note_value := NULLIF(btrim(p_data->>'admin_note'), '');
        transfer_reference_value := NULLIF(btrim(p_data->>'transfer_reference'), '');
        proof_path := NULLIF(p_data->>'transfer_screenshot_path', '');
        IF length(COALESCE(note_value, '')) > 2000 OR length(COALESCE(transfer_reference_value, '')) > 120
           OR (decision_value = 'Approved' AND transfer_reference_value IS NULL) THEN
            RAISE EXCEPTION 'Enter the GCash transfer transaction number before approving the refund';
        END IF;
        IF proof_path IS NOT NULL
           AND proof_path !~ ('^' || auth.uid()::text || '/refund-transfer/' || refund_id_value::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') THEN
            RAISE EXCEPTION 'Invalid refund transfer proof path';
        END IF;
        SELECT rr.* INTO refund_row
          FROM public."refund_requests" AS rr
         WHERE rr."refund_id" = refund_id_value
         FOR UPDATE;
        IF refund_row."refund_id" IS NULL OR refund_row."status" <> 'Pending' THEN
            RAISE EXCEPTION 'This refund request is no longer pending';
        END IF;
        IF proof_path IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM storage.objects
             WHERE bucket_id = 'mbh-financial-evidence' AND name = proof_path
        ) THEN RAISE EXCEPTION 'Refund transfer proof upload was not found'; END IF;
        IF decision_value = 'Approved' THEN
            SELECT p."amount", COALESCE(sum(other."refund_amount"), 0)
              INTO subtotal, refund_total
              FROM public."payments" AS p
              LEFT JOIN public."refund_requests" AS other
                ON other."payment_id" = p."payment_id"
               AND other."status" = 'Approved'
               AND other."refund_id" <> refund_id_value
             WHERE p."payment_id" = refund_row."payment_id"
             GROUP BY p."payment_id";
            IF refund_row."refund_amount" > GREATEST(subtotal - refund_total, 0) THEN
                RAISE EXCEPTION 'Refund amount exceeds the payment remaining refundable balance';
            END IF;
        END IF;
        UPDATE public."refund_requests"
           SET "status" = decision_value,
               "admin_note" = note_value,
               "acted_by" = actor_id,
               "acted_at" = CURRENT_TIMESTAMP,
               "transfer_reference" = CASE WHEN decision_value = 'Approved' THEN transfer_reference_value ELSE "transfer_reference" END,
               "transfer_screenshot_path" = CASE WHEN decision_value = 'Approved' THEN proof_path ELSE "transfer_screenshot_path" END
         WHERE "refund_id" = refund_id_value;
        INSERT INTO public."notifications" ("user_id", "title", "message", "type")
        VALUES (
            refund_row."user_id",
            CASE WHEN decision_value = 'Approved' THEN 'Refund Approved' ELSE 'Refund Rejected' END,
            CASE WHEN decision_value = 'Approved'
                 THEN 'Your refund request #' || refund_id_value || ' was approved.'
                 ELSE 'Your refund request #' || refund_id_value || ' was rejected.' ||
                      CASE WHEN note_value IS NULL THEN '' ELSE ' Admin note: ' || note_value END
            END,
            'refund'
        );
        INSERT INTO public."system_logs" ("actor_id", "category", "action", "message")
        VALUES (actor_id, 'payment', 'refund_' || lower(decision_value),
                'Admin ' || actor_id || ' ' || lower(decision_value) || ' refund #' || refund_id_value);
        RETURN jsonb_build_object('type', 'success', 'message', 'Refund request ' || lower(decision_value), 'data', NULL);
    END IF;

    RAISE EXCEPTION 'Invalid financial action';
END;
$$;

REVOKE ALL ON FUNCTION public.manage_financial_workflows(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_financial_workflows(text, jsonb) TO authenticated;
