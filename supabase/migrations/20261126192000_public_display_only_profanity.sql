DROP TRIGGER IF EXISTS "ratings_mask_public_profanity" ON public."ratings";
DROP TRIGGER IF EXISTS "promotional_video_comments_mask_profanity"
    ON public."promotional_video_comments";
DROP TRIGGER IF EXISTS "promotional_video_replies_mask_profanity"
    ON public."promotional_video_replies";

DROP FUNCTION IF EXISTS public.mask_public_profanity_before_write();
DROP FUNCTION IF EXISTS public.mask_profanity(text);
