CREATE OR REPLACE FUNCTION public.mask_profanity(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
    result text := p_text;
    phrase_pattern text;
    phrase_patterns text[] := ARRAY[
        'putang[[:space:][:punct:]]*ina([[:space:][:punct:]]*mo)?',
        'potang[[:space:][:punct:]]*ina([[:space:][:punct:]]*mo)?',
        'tang[[:space:][:punct:]]*ina([[:space:][:punct:]]*mo)?',
        'pucha[[:space:][:punct:]]+ina',
        'king[[:space:][:punct:]]*ina',
        'walang[[:space:]]+hiya',
        'anak[[:space:]]+ng[[:space:]]+puta',
        'mother[[:space:][:punct:]]*fucker',
        'son[[:space:]]+of[[:space:]]+a[[:space:]]+bitch',
        'jesus[[:space:]]+christ'
    ];
    phrase_match text[];
    token_match text[];
    filtered_words text[] := ARRAY[
        'ass','asses','asshat','asshats','asshole','assholes','arse','arsehole','bastard','bastards',
        'beaner','beaners','bitch','biatch','bitches','bitchy','bollocks','bullshit',
        'bugger','buggers','chink','chinks','cock','cocksucker','cocksuckers','coon','coons',
        'cunt','cunts','crap','crappy','damn','damned','damning','dammit','dick','dickhead','dicks','dyke','dykes',
        'douche','douchebag','douchebags','dumbass','dumbasses','fag','faggot','faggots',
        'fuck','fck','fuk','fucc','phuck','phuk','fucked','fucker','fuckers','fucking',
        'fuckface','fuckfaces','fucks','goddamn','goddamned','goddammit','gook','gooks','hell',
        'horseshit','idiot','idiots','imbecile','jackass','jackasses','jerk','jerks','kike',
        'kikes','motherfucker','motherfuckers','motherfucking','nigga','niggas','nigger',
        'niggers','moron','morons','freak','freaks','piss','pissed','pissing','prick','pricks',
        'pussy','pussies','retard','retards','retarded','raghead','ragheads','spic','spics',
        'shit','shits','shitted','shitting','shitty','shithead','shitheads','shithole','shitholes',
        'scumbags','slut','sluts','stupid','shite','shyt','sht','twat','twats','tranny','trannies','wanker','wankers','wetback',
        'wetbacks','whore','whores','puta','putas','pota','putangina','putanginamo','putanginamoka',
        'potangina','potanginamo','potanginaka','tangina','tanginamo',
        'tanginaka','tanginamoha','kingina','kinginamo','pucha','puchangina','pakyu','pakyo','pakyow','pakshet',
        'pakshit','pakingshet','shet','syet','shuta','shutaena','gago','gaga','gagi','gagoha',
        'gaguhan','tanga','tangahan','bobo','bobong','ulol','ulul','hayop','hayup','hayupak',
        'walanghiya','anakngputa','tarantado','tarantada','inutil','unggoy','kupal','kupalo',
        'bwisit','bilat','buwisit','bwesit','buang','pisti','peste','lintik','yawa','yati','hinayupak',
        'leche','letse','lecheng','punyeta','punyemas','putragis','potaena',
        'potaenamo','hindot','kantot','kantutan','kantutin','iyot','iyotan','burat','titi',
        'tite','etits','pepe','puke','puki','pekpek','pwet','puwet','bayag','betlog','burikat',
        'libog','tae','tililing','boba','bobita','bobito','engot','obob','siraulo',
        'baliw','demonyo','animal','scumbag','loser','losers','worthless'
    ];
    remaining text;
    token text;
    normalized text;
    collapsed_once text;
    collapsed_twice text;
    token_start integer;
    cursor_position integer;
    phrase_start integer;
BEGIN
    IF p_text IS NULL OR p_text = '' THEN
        RETURN p_text;
    END IF;

    FOREACH phrase_pattern IN ARRAY phrase_patterns LOOP
        cursor_position := 1;
        LOOP
            remaining := substring(result FROM cursor_position);
            phrase_match := regexp_match(
                remaining,
                '(^|[^[:alnum:]])(' || phrase_pattern || ')([^[:alnum:]]|$)',
                'i'
            );
            EXIT WHEN phrase_match IS NULL;

            phrase_start := cursor_position + strpos(remaining, phrase_match[2]) - 1;
            result := overlay(
                result PLACING regexp_replace(phrase_match[2], '[[:alnum:]]', '*', 'g')
                FROM phrase_start FOR char_length(phrase_match[2])
            );
            cursor_position := phrase_start + char_length(phrase_match[2]);
        END LOOP;
    END LOOP;

    cursor_position := 1;
    LOOP
        remaining := substring(result FROM cursor_position);
        token_match := regexp_match(
            remaining,
            '([[:alnum:]]+([.@$*!_+-]+[[:alnum:]]+)*)'
        );
        EXIT WHEN token_match IS NULL;

        token := token_match[1];
        token_start := cursor_position + strpos(remaining, token) - 1;
        normalized := lower(translate(token, '0123456789@$!', 'oizeasgtbgasi'));
        normalized := regexp_replace(normalized, '[àáâäãåā]', 'a', 'g');
        normalized := regexp_replace(normalized, '[èéêëē]', 'e', 'g');
        normalized := regexp_replace(normalized, '[ìíîïī]', 'i', 'g');
        normalized := regexp_replace(normalized, '[òóôöõō]', 'o', 'g');
        normalized := regexp_replace(normalized, '[ùúûüū]', 'u', 'g');
        normalized := regexp_replace(normalized, '[ñ]', 'n', 'g');
        normalized := regexp_replace(normalized, '[^a-z]', '', 'g');
        collapsed_once := regexp_replace(normalized, '(.)\1+', '\1', 'g');
        collapsed_twice := regexp_replace(normalized, '(.)\1+', '\1\1', 'g');

        IF normalized = ANY(filtered_words)
            OR collapsed_once = ANY(filtered_words)
            OR collapsed_twice = ANY(filtered_words) THEN
            result := overlay(
                result PLACING regexp_replace(token, '[[:alnum:]]', '*', 'g')
                FROM token_start FOR char_length(token)
            );
        END IF;

        cursor_position := token_start + char_length(token);
    END LOOP;

    RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mask_public_profanity_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF TG_TABLE_NAME = 'promotional_video_comments' THEN
        NEW."comment" := public.mask_profanity(NEW."comment");
    ELSIF TG_TABLE_NAME = 'promotional_video_replies' THEN
        NEW."reply" := public.mask_profanity(NEW."reply");
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "promotional_video_comments_mask_profanity"
    ON public."promotional_video_comments";
CREATE TRIGGER "promotional_video_comments_mask_profanity"
    BEFORE INSERT OR UPDATE ON public."promotional_video_comments"
    FOR EACH ROW
    EXECUTE FUNCTION public.mask_public_profanity_before_write();

DROP TRIGGER IF EXISTS "promotional_video_replies_mask_profanity"
    ON public."promotional_video_replies";
CREATE TRIGGER "promotional_video_replies_mask_profanity"
    BEFORE INSERT OR UPDATE ON public."promotional_video_replies"
    FOR EACH ROW
    EXECUTE FUNCTION public.mask_public_profanity_before_write();

UPDATE public."promotional_video_comments"
   SET "comment" = public.mask_profanity("comment")
 WHERE public.mask_profanity("comment") IS DISTINCT FROM "comment";

UPDATE public."promotional_video_replies"
   SET "reply" = public.mask_profanity("reply")
 WHERE public.mask_profanity("reply") IS DISTINCT FROM "reply";
