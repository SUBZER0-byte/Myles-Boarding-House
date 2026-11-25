UPDATE storage.buckets
   SET file_size_limit = 104857600
 WHERE id IN (
     'mbh-profile-pictures',
     'mbh-chat-images',
     'mbh-request-photos',
     'mbh-payment-qrs'
 );

DO $$
DECLARE
    function_signature regprocedure;
    function_definition text;
BEGIN
    IF (
        SELECT count(*)
          FROM storage.buckets
         WHERE id IN (
             'mbh-profile-pictures',
             'mbh-chat-images',
             'mbh-request-photos',
             'mbh-payment-qrs'
         )
           AND file_size_limit = 104857600
    ) <> 4 THEN
        RAISE EXCEPTION 'Could not set all requested image buckets to 100 MB.';
    END IF;

    FOREACH function_signature IN ARRAY ARRAY[
        'public.attach_tenant_complaint_attachments(integer,jsonb)'::regprocedure,
        'public.attach_tenant_maintenance_attachments(integer,jsonb)'::regprocedure
    ]
    LOOP
        function_definition := pg_get_functiondef(function_signature);
        IF strpos(function_definition, 'attachment_size > 10485760') > 0
           AND strpos(function_definition, '10MB or smaller.') > 0 THEN
            function_definition := replace(function_definition, 'attachment_size > 10485760', 'attachment_size > 104857600');
            function_definition := replace(function_definition, '10MB or smaller.', '100MB or smaller.');
            EXECUTE function_definition;
        ELSIF strpos(function_definition, 'attachment_size > 10485760') = 0
           AND strpos(function_definition, '10MB or smaller.') = 0
           AND strpos(function_definition, 'attachment_size > 104857600') > 0
           AND strpos(function_definition, '100MB or smaller.') > 0 THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'Unexpected tenant request image size validation for %', function_signature;
        END IF;
    END LOOP;
END;
$$;
