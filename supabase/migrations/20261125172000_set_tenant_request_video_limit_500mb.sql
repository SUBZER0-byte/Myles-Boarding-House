UPDATE storage.buckets
   SET file_size_limit = 524288000
 WHERE id = 'mbh-request-photos';

DO $$
DECLARE
    function_signature regprocedure;
    function_definition text;
    video_message_position integer;
    video_guard_reverse_position integer;
    video_guard_position integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM storage.buckets
         WHERE id = 'mbh-request-photos'
           AND file_size_limit = 524288000
    ) THEN
        RAISE EXCEPTION 'Could not set the tenant request bucket-specific file size limit to 500 MB.';
    END IF;

    FOREACH function_signature IN ARRAY ARRAY[
        'public.attach_tenant_complaint_attachments(integer,jsonb)'::regprocedure,
        'public.attach_tenant_maintenance_attachments(integer,jsonb)'::regprocedure
    ]
    LOOP
        function_definition := pg_get_functiondef(function_signature);
        IF strpos(function_definition, 'attachment_size > 524288000') > 0
           AND strpos(function_definition, '500MB or smaller.') > 0
           AND strpos(function_definition, 'attachment_size > 104857600') > 0
           AND strpos(function_definition, '100MB or smaller.') > 0 THEN
            NULL;
        ELSE
            IF strpos(function_definition, 'Video must be MP4, WEBM, or MOV.') = 0
               OR strpos(function_definition, 'attachment_size > 104857600') = 0
               OR strpos(function_definition, '100MB or smaller.') = 0 THEN
                RAISE EXCEPTION 'Unexpected tenant request attachment validation for %', function_signature;
            END IF;

            video_message_position := strpos(
                function_definition,
                'Video must be MP4, WEBM, or MOV.'
            );
            video_guard_reverse_position := strpos(
                reverse(substring(function_definition FROM 1 FOR video_message_position - 1)),
                reverse('attachment_size < 1')
            );
            IF video_guard_reverse_position = 0 THEN
                RAISE EXCEPTION 'Could not locate the tenant request video size check for %', function_signature;
            END IF;

            video_guard_position := video_message_position
                - video_guard_reverse_position
                - length('attachment_size < 1')
                + 1;
            function_definition := substring(function_definition FROM 1 FOR video_guard_position - 1)
                || 'attachment_size < 1 OR attachment_size > 524288000'
                || substring(function_definition FROM video_guard_position + length('attachment_size < 1'));
            function_definition := replace(
                function_definition,
                'Video must be MP4, WEBM, or MOV.',
                'Video must be MP4, WEBM, or MOV and 500MB or smaller.'
            );

            IF strpos(function_definition, 'attachment_size > 524288000') = 0
               OR strpos(function_definition, '500MB or smaller.') = 0
               OR strpos(function_definition, 'attachment_size > 104857600') = 0
               OR strpos(function_definition, '100MB or smaller.') = 0 THEN
                RAISE EXCEPTION 'Could not set the tenant request video size limit for %', function_signature;
            END IF;

            EXECUTE function_definition;
        END IF;
    END LOOP;
END;
$$;
