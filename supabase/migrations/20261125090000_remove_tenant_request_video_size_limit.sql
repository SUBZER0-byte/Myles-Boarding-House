UPDATE storage.buckets
   SET file_size_limit = NULL
 WHERE id = 'mbh-request-photos';

DO $$
DECLARE
    function_signature regprocedure;
    function_definition text;
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM storage.buckets
         WHERE id = 'mbh-request-photos'
           AND file_size_limit IS NULL
    ) THEN
        RAISE EXCEPTION 'Could not remove the tenant request bucket-specific file size limit.';
    END IF;

    FOREACH function_signature IN ARRAY ARRAY[
        'public.attach_tenant_complaint_attachments(integer,jsonb)'::regprocedure,
        'public.attach_tenant_maintenance_attachments(integer,jsonb)'::regprocedure
    ]
    LOOP
        function_definition := pg_get_functiondef(function_signature);
        IF strpos(function_definition, 'OR attachment_size > 104857600') > 0
           AND strpos(function_definition, '100MB or smaller.') > 0 THEN
            function_definition := replace(function_definition, 'OR attachment_size > 104857600', '');
            function_definition := replace(function_definition, ' and 100MB or smaller.', '.');
            EXECUTE function_definition;
        ELSIF strpos(function_definition, 'attachment_size > 104857600') > 0
           OR strpos(function_definition, 'attachment_size > 52428800') > 0
           OR strpos(function_definition, '100MB or smaller.') > 0
           OR strpos(function_definition, '50MB or smaller.') > 0 THEN
            RAISE EXCEPTION 'Unexpected tenant request video size validation for %', function_signature;
        END IF;
    END LOOP;
END;
$$;
