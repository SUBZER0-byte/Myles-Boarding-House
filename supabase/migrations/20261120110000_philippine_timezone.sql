ALTER DATABASE postgres SET timezone TO 'Asia/Manila';

ALTER ROLE postgres SET timezone TO 'Asia/Manila';
ALTER ROLE authenticator SET timezone TO 'Asia/Manila';
ALTER ROLE anon SET timezone TO 'Asia/Manila';
ALTER ROLE authenticated SET timezone TO 'Asia/Manila';
ALTER ROLE service_role SET timezone TO 'Asia/Manila';
