# Supabase and application environment

## Frontend (`frontend/.env`)

Copy `frontend/.env.example` to `frontend/.env` for local Vite development.
The frontend reads only:

- `VITE_API_BASE_URL`: the external PHP API base URL while PHP-backed features
  remain.
- `VITE_SUPABASE_URL`: the Supabase Project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key (legacy `anon`
  key is also supported).

Vite embeds `VITE_*` variables in browser assets. These must never contain a
database password, `service_role` key, Edge Function secret, or payment/SMS/AI
provider credential. Do not set `VITE_API_BASE_URL` to the Supabase URL; it is
for the remaining PHP API.

## Edge Function secrets

Copy `supabase/.env.example` to `supabase/.env` for local Edge Function
development. Start the functions with:

```powershell
supabase functions serve --env-file supabase/.env
```

Supabase CLI provides project keys for local functions. Keep provider credentials
in this file only for local testing. In the hosted project, set the required
values under **Supabase Dashboard > Edge Functions > Secrets** or through the
authenticated Supabase CLI. The `auth` function needs `APP_ALLOWED_ORIGINS` and,
for SMS OTP, `TEXTBEE_API_BASE`, `TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`, and
`TEXTBEE_ENABLED=true`. The chatbot needs `OLLAMA_API_KEY` and the allowed
production origin. Set `ADMIN_BOOTSTRAP_TOKEN` and
`ADMIN_BOOTSTRAP_PASSWORD` only temporarily when performing the documented
one-time bootstrap, then remove them.

Do not upload local bootstrap credentials or development-only values as hosted
secrets. Edge Function deployment and secret changes are separate from Vercel
deployments.

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

## References

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase CLI](https://supabase.com/docs/reference/cli/supabase-db-push)
