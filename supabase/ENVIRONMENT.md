# Supabase and application environment

## Frontend (`frontend/.env`)

Copy `frontend/.env.example` to `frontend/.env` for local Vite development.
The frontend reads only:

- `VITE_API_BASE_URL`: the external PHP API base URL while PHP-backed features
  remain.
- `VITE_SUPABASE_URL`: the Supabase Project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key (legacy `anon`
  key is also supported).

For the Vercel deployment, set these same three names in **Project Settings >
Environment Variables**. The project root directory must be `frontend`. Vercel
provides them to the Vite build; changing a value requires a new deployment.
The local `frontend/.env` file is not uploaded to Vercel.

`VITE_API_BASE_URL` is only the base URL for the remaining legacy PHP API and
PHP-hosted assets. It must not be the Supabase URL. `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` configure the browser's Supabase client and are
intended to be public; Supabase Row-Level Security and Auth policies protect
data access. The app already reads these variables at build time.

Vite embeds `VITE_*` variables in browser assets. These must never contain a
database password, `service_role` key, Edge Function secret, or payment/SMS/AI
provider credential. Do not set `VITE_API_BASE_URL` to the Supabase URL; it is
for the remaining PHP API.

## Edge Function secrets

Vercel environment variables are not automatically available to Supabase Edge
Functions. A variable without the `VITE_` prefix is not exposed to this static
frontend, and setting one in Vercel does not configure the Supabase runtime.
Keep provider credentials and other private values in the Supabase project's
Edge Function secrets.

Copy `supabase/.env.example` to `supabase/.env` for local Edge Function
development. Start the functions with:

```powershell
supabase functions serve --env-file supabase/.env
```

Supabase CLI provides project keys for local functions. Keep provider credentials
in this file only for local testing. Functions now prefer `SUPABASE_SECRET_KEY`
over the platform-provided legacy `SUPABASE_SERVICE_ROLE_KEY`; the auth function
prefers `SUPABASE_PUBLISHABLE_KEY` over `SUPABASE_ANON_KEY`. In the hosted
project, set these keys and the required values under **Supabase Dashboard >
Edge Functions > Secrets** or through the authenticated Supabase CLI. The `auth`
function needs `APP_ALLOWED_ORIGINS` and, for SMS OTP, `TEXTBEE_API_BASE`,
`TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`, and `TEXTBEE_ENABLED=true`. The chatbot
needs `OLLAMA_API_KEY` and the allowed production origin. Set `ADMIN_BOOTSTRAP_TOKEN` and
`ADMIN_BOOTSTRAP_PASSWORD` only temporarily when performing the documented
one-time bootstrap, then remove them.

Do not upload local bootstrap credentials or development-only values as hosted
secrets. Edge Function deployment and secret changes are separate from Vercel
deployments. The browser does not use `SUPABASE_SECRET_KEY`; never prefix it
with `VITE_` or put it in a frontend build environment. `SUPABASE_JWKS_URL` is
not required by the current functions: authenticated endpoints validate access
tokens through Supabase Auth (`auth.getUser`), while the Edge Function gateway
verifies functions configured with `verify_jwt = true`. Only configure JWKS if
adding code that directly verifies JWTs with the project's public signing keys.

## Legacy PHP backend

The remaining PHP API is a separate server and does not automatically read
`frontend/.env` or `supabase/.env`. Configure its process environment in the PHP
host for `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
`PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`,
`PAYMONGO_SECRET_KEY`, `PAYMONGO_PUBLIC_KEY`, `PAYMONGO_WEBHOOK_SECRET`, and
`APP_BASE_URL` as needed. Its PHP configuration reads these server environment
variables and may use the ignored `backend/Config/secrets.php` as a local
fallback. Never copy those credentials into Vercel frontend variables. The
legacy TextBee PHP integration currently reads settings from MySQL; the
Supabase Auth Edge Function separately uses its Edge Function secrets.

## PostgreSQL connection URL

The browser app uses Supabase's HTTPS Data API through `supabase-js` and
Row-Level Security. It must not connect to Postgres directly. `DATABASE_URL` is
for trusted tools such as migration/backup workflows only.

Copy `supabase/DATABASE_URL.env.example` to `supabase/.env.db`. In the Supabase
Dashboard, open **Connect**, select the connection mode, and copy its complete
connection string; replace the password with the database password for the
project. Do not guess the project reference, host, or pooler address. Percent
encode reserved characters in the password as directed by the Dashboard.

For the supplied direct-connection format:

```text
postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres
```

The direct database endpoint may require IPv6 (or the project's IPv4 add-on).
For an IPv4-only local network, choose the **Session pooler** URL in the
Dashboard instead. Serverless database clients should use the **Transaction
pooler**; this app's browser should continue using the Data API.

To load the private URL into a PowerShell process without printing it:

```powershell
$line = Get-Content -LiteralPath 'supabase/.env.db' |
  Where-Object { $_ -match '^DATABASE_URL=' } |
  Select-Object -First 1
if (-not $line) { throw 'DATABASE_URL is missing from supabase/.env.db' }
$env:DATABASE_URL = $line.Substring('DATABASE_URL='.Length)
```

Then review the migrations and target before using the Supabase CLI:

```powershell
supabase db push "--remote=$env:DATABASE_URL" --dry-run
```

Remove `--dry-run` only after reviewing the target and pending migrations;
applying migrations changes the remote database. Do not use a production URL
for local tests.

## Authentication setup

The frontend uses the Supabase Auth session with automatic token refresh and
persistent browser storage. Username/password sign-in, guest registration,
password reset, and phone OTP are routed through the `auth` Edge Function;
database access is authorized using the signed-in JWT and role-checked RPCs.
The sign-up function creates the Auth user only after the SMS OTP has been
verified. This is not a direct browser `auth.signUp()` flow.

In the hosted Supabase Dashboard:

1. Enable the Email provider for password sign-in.
2. Set **Authentication > URL Configuration > Site URL** to
   `https://myles-boarding-house.vercel.app`.
3. Add `https://myles-boarding-house.vercel.app/**` and
   `http://localhost:5173/**` to the redirect URL allowlist. Add only exact,
   trusted preview origins if preview deployments need Auth.
4. Configure production SMTP if users must receive email-change confirmations.
5. Set the `auth` Edge Function's `APP_ALLOWED_ORIGINS` to the production
   origin and any trusted local/preview origins. CORS and Auth redirect
   allowlists are separate settings.
6. Configure the TextBee Edge Function secrets if phone OTP is enabled.

`supabase/config.toml` mirrors the production/local site and redirect URLs for
local Supabase development. It does not update the hosted Auth URL configuration
by itself. Existing accounts also need valid `auth_user_id` links in
`public.users`; setting environment variables cannot backfill identity records.

## Deployed chat/chatbot 404 or CORS errors

The frontend, database migrations, and Edge Functions deploy separately. If the
production browser reports `404` for `manage_my_chat` or
`get_public_chatbot_suggestions`, first confirm that the `VITE_SUPABASE_URL`
configured in Vercel points to the same Supabase project you are inspecting.
Those RPCs are created by:

- `20261114000000_chat_workflows.sql` (`manage_my_chat`)
- `20261114010000_chatbot_service.sql` (`get_public_chatbot_suggestions` and the
  chatbot rate-limit service)

The Admin FAQ/question RPCs also require `20261114020000_admin_chatbot_settings.sql`.
After confirming the intended project and reviewing every pending migration,
use `supabase db push --dry-run` first. `supabase db push` applies all pending
migrations, not only the two chat migrations; do not apply it until the pending
list and target are understood.

An Edge Function request that appears as a CORS failure can also mean the
requested function is missing or the deployed code does not allow the browser
origin. Confirm that `admin-tenants` and `chatbot` appear in the intended
project's Edge Functions list, then deploy any missing functions only after
confirming the project reference:

```text
supabase functions deploy admin-tenants --project-ref <project-ref>
supabase functions deploy chatbot --project-ref <project-ref>
```

`APP_ALLOWED_ORIGINS` is a secret name/value pair under **Edge Functions >
Secrets**, not an Edge Function name. Set its value to the exact production
origin `https://myles-boarding-house.vercel.app` (plus only deliberately allowed
preview/local origins). A function named like
`APP_ALLOWED_ORIGINS-https---myles-boarding-house-vercel-app` does not configure
CORS; if it was created accidentally, remove it only after confirming it is not
used. Set `OLLAMA_API_KEY` there too if chatbot responses should be enabled.
Keep the chatbot's `verify_jwt = false` setting because the public widget is
anonymous. The CORS allowlist, function deployment, and database migration
state are independent; verify all three before expecting the deployed frontend
to work. Deploy the frontend after its database and function dependencies are
ready.

## References

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase CLI](https://supabase.com/docs/reference/cli/supabase-db-push)
