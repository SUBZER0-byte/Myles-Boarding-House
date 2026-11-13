BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SELECT ok(
    (SELECT count(*) <= 10 FROM public.get_public_chatbot_suggestions()),
    'public suggested-question feed is bounded'
);

SET LOCAL ROLE service_role;
SELECT ok(
    public.consume_chatbot_rate_limit(repeat('a', 64), 2, 60),
    'first request is allowed by its rate limit'
);
SELECT ok(
    public.consume_chatbot_rate_limit(repeat('a', 64), 2, 60),
    'second request is allowed by its rate limit'
);
SELECT ok(
    NOT public.consume_chatbot_rate_limit(repeat('a', 64), 2, 60),
    'requests above the configured limit are blocked'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
