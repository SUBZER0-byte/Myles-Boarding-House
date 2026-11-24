UPDATE storage.buckets
   SET file_size_limit = 104857600
 WHERE id = 'mbh-request-photos';

DO $$
DECLARE
    function_signature regprocedure;
    function_definition text;
BEGIN
    FOREACH function_signature IN ARRAY ARRAY[
        'public.attach_tenant_complaint_attachments(integer,jsonb)'::regprocedure,
        'public.attach_tenant_maintenance_attachments(integer,jsonb)'::regprocedure
    ]
    LOOP
        function_definition := pg_get_functiondef(function_signature);
        IF strpos(function_definition, '52428800') > 0
           AND strpos(function_definition, '50MB or smaller.') > 0 THEN
            function_definition := replace(function_definition, '52428800', '104857600');
            function_definition := replace(function_definition, '50MB or smaller.', '100MB or smaller.');
            EXECUTE function_definition;
        ELSIF strpos(function_definition, '104857600') = 0
           OR strpos(function_definition, '100MB or smaller.') = 0 THEN
            RAISE EXCEPTION 'Unexpected tenant request attachment validation for %', function_signature;
        END IF;
    END LOOP;
END;
$$;
