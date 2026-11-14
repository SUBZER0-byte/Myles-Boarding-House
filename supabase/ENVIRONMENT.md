# Supabase and application environment

## Production deployment runbook: Vercel + Supabase

Adding environment variables alone does not deploy the database schema,
Storage policies, or Edge Functions. Deploy those Supabase dependencies before
pointing the Vercel frontend at the project.

### Values to collect

| Value | Where to get it | Where it belongs |
|---|---|---|
| Supabase Project URL | Supabase Dashboard > Project Settings > API | Vercel `VITE_SUPABASE_URL` |
| Publishable key | Supabase Dashboard > Project Settings > API Keys | Vercel `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Project reference | The project reference in the Project URL / dashboard | Supabase CLI `link` and deploy commands; it is not a secret |
| Database password | Supabase Dashboard > Connect / Database settings | Supabase CLI prompt or ignored `supabase/.env.db`; never Vercel |
| Supabase secret key | Supabase Dashboard > Project Settings > API Keys | Supabase Edge Function Secrets as `SUPABASE_SECRET_KEY`; never Vercel |
| Vercel production origin | Vercel > Project > Domains | Supabase Auth URLs and Edge Function `APP_ALLOWED_ORIGINS` |
| TextBee credentials | TextBee account/device configuration | Supabase Edge Function Secrets, if SMS OTP/alerts are enabled |
| Gemini API key | Google AI Studio | Supabase Edge Function Secrets as `GEMINI_API_KEY`; never Vercel |

`VITE_SUPABASE_URL` is the Supabase Project URL, not the Storage S3 endpoint.
The browser uses `supabase-js` for Auth, database API, and Storage. Do not add a
service-role/secret key, Postgres URL, S3 access key, TextBee key, or Gemini key
to a `VITE_*` setting.

For a self-hosted Supabase deployment, see
[SELF_HOSTED_DEPLOYMENT.md](./SELF_HOSTED_DEPLOYMENT.md). The frontend can use
either Supabase Cloud or a self-hosted HTTPS API gateway through the same
`VITE_SUPABASE_URL` setting; it must be the gateway base URL, not the `/rest/v1/`
Data API URL.

### 1. Confirm the target and review database migrations

Use the project reference from the same Supabase project as the Vercel
`VITE_SUPABASE_URL`. The `project_id` in `supabase/config.toml` is only a local
project name; it is not necessarily the hosted project reference.

From the repository root in PowerShell:

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref "YOUR_PROJECT_REF"
npx.cmd supabase migration list --remote
npx.cmd supabase db push --remote --dry-run
```

The repository currently contains 32 SQL migration files. Review the target
shown by the CLI and every migration listed by the dry run. The existing
Supabase project already has tables and Storage objects, so do not blindly
apply all pending migrations or manually mark them as applied. The baseline
uses `CREATE TABLE IF NOT EXISTS`, which does not prove that an existing table
has the expected columns, constraints, or policies. Take a database backup and
stop to reconcile the schema/history if the CLI proposes an unexpected
baseline or migration set.

Only after the project, backup, migration history, and dry-run output have been
reviewed should you apply the pending SQL:

```powershell
npx.cmd supabase db push --remote
npx.cmd supabase migration list --remote
```

Do not run the user-provided table-only schema snapshot as SQL. It does not
include the application RPCs, authorization policies, or Storage policies.
Do not put the database connection string or password in Vercel.

### 2. Configure and deploy Edge Functions

In Supabase Dashboard > Edge Functions > Secrets, set only the values required
for enabled features:

- `APP_ALLOWED_ORIGINS=https://myles-boarding-house.vercel.app` (add only
  explicitly trusted local or preview origins).
- `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY` if using the new API key
  names. The functions retain platform-provided legacy key fallbacks.
- TextBee: `TEXTBEE_ENABLED=true` (lowercase), `TEXTBEE_API_BASE=https://api.textbee.dev/api/v1`, and `TEXTBEE_API_KEY`. `TEXTBEE_DEVICE_ID` is optional if TextBee should use the account's default device.
- Gemini API: `GEMINI_API_KEY`; `GEMINI_MODEL` is optional and defaults to
  `gemini-3.5-flash-lite` (free-tier model, subject to Google's project quotas).
- `ADMIN_BOOTSTRAP_TOKEN` and `ADMIN_BOOTSTRAP_PASSWORD` only temporarily if
  the one-time Admin bootstrap is still needed; remove them immediately after.

Do not upload the entire local `supabase/.env` as hosted secrets: it can contain
local-only or temporary values. The tracked `supabase/.env.example` must
contain blank placeholders only. If any provider or Supabase secret was exposed
in a file, terminal, or chat, revoke/rotate it and update the ignored local
`.env` and hosted Supabase secrets. `SUPABASE_JWKS_URL` is not used by the
current token-verification flow.

The TextBee integration sends `POST ${TEXTBEE_API_BASE}/gateway/send-sms` with
the `x-api-key` header and a JSON `recipients` array, `message`, and optional
`deviceId`. Keep the registered Android gateway device online. A successful
HTTP 200 means TextBee queued the message; verify delivery on a test phone
before relying on OTP or urgent alerts.

The chatbot calls Gemini's `generateContent` API at
`https://generativelanguage.googleapis.com` with `GEMINI_API_KEY` in the
`x-goog-api-key` header. The default `gemini-3.5-flash-lite` model currently
offers free-tier input/output tokens subject to project quotas. Google's free
tier may use submitted content to improve its products, so do not send private
tenant, payment, authentication, or other sensitive information. Keep the key
in Supabase Function Secrets, never in Vercel or browser code.

After setting the secrets, deploy all local Edge Functions (the shared helper
is bundled into them and is not deployed separately):

```powershell
npx.cmd supabase functions deploy --remote="YOUR_PROJECT_REF" --use-api
```

The `--use-api` option avoids requiring Docker for function bundling. Confirm
that all 16 application functions appear in the intended Supabase project.
Function deployment and SQL migration deployment are separate operations.

### 3. Configure Auth and Storage

In Supabase Dashboard > Authentication > URL Configuration:

1. Set **Site URL** to `https://myles-boarding-house.vercel.app`.
2. Add `https://myles-boarding-house.vercel.app/**` to the redirect allowlist.
3. Add `http://localhost:5173/**` only for local development; add exact trusted
   preview URLs only if previews need authentication.
4. Enable the Email provider for password sign-in. Configure SMTP if users need
   email-change confirmations.
5. Configure the TextBee Edge Function secrets before relying on the current
   phone-OTP registration flow. Register an Android gateway device and keep it
   online; TextBee's HTTP 200 response confirms queueing, not carrier delivery.

The migrations create these application Storage buckets and scoped policies:

| Bucket | Access | Use |
|---|---|---|
| `mbh-profile-pictures` | Public reads; owner-scoped writes | Profile images |
| `mbh-room-images` | Public reads; Admin writes | Room covers and photos |
| `mbh-request-photos` | Private | Tenant complaint/maintenance photos |
| `mbh-financial-evidence` | Private, owner/Admin checks | Rent, full-payment, and refund evidence |
| `mbh-payment-qrs` | Private, role-checked | GCash QR images |
| `mbh-booking-payment-proofs` | Private, Guest/Admin checks | Guest booking payment proofs |
| `mbh-chat-images` | Private, conversation-participant checks | Chat attachments |

The Storage screenshots shared for this setup show only
`mbh-request-photos` and `mbh-profile-pictures`. The other buckets are created
by their SQL migrations; verify all seven exist after migrations are applied.
Do not replace them with one general-purpose public bucket or broaden their
policies. The Storage S3 endpoint and access keys are not needed by this
browser app; its uploads use `supabase-js`.

### 4. Configure and deploy the Vercel frontend

In Vercel > Project > Settings > General, set:

- **Root Directory:** `frontend`
- **Framework Preset:** Vite
- **Install Command:** `npm install`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

Add these **Production** environment variables (and Preview only if needed):

```text
VITE_SUPABASE_URL=<Project URL from Supabase>
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key from the same project>
```

Save the variables and redeploy. `frontend/vercel.json` supplies the SPA rewrite
for direct navigation to React routes.

### 5. Smoke-test and decide whether cutover is complete

Use test accounts and payment-provider sandbox/test modes:

1. Open the public site and confirm room listings and public images load.
2. Register a Guest using the configured OTP delivery; sign in, reset password,
   refresh, and sign out.
3. Test Admin, Tenant, and Guest role access with separate accounts.
4. Upload a profile image, room photo, request photo, chat attachment, payment
   proof, and Admin GCash QR; confirm each uses the bucket above and the
   expected public or signed/private access.
5. Test guest booking, Tenant payments/requests, Admin review, notifications,
   and chatbot if enabled. Use test data and sandbox payment credentials.
6. In browser Network tools, verify data/Auth/Storage requests go to the
   intended Supabase project. The PHP URL should be used only by legacy image
   fallbacks while those remain.

### Current migration readiness

The local Admin/Tenant/Guest data and Auth paths are largely Supabase-backed,
but this workspace cannot certify a complete production cutover:

- The 32 SQL migrations and 16 Edge Functions have not been verified against
  the remote project's migration history and function list in this deployment.
- The screenshots show only two of the seven Storage buckets expected by the
  current code. Apply and verify the corresponding migrations before depending
  on the missing buckets.
- PHP-relative image fallbacks have been removed from the frontend. Existing
  PHP-relative image paths will not display until their files are copied to
  Supabase Storage and their database paths are updated.
- The legacy PayPal payment/configuration workflow remains PHP-backed. Do not
  retire the PHP host while PayPal is enabled; migrate that workflow or
  explicitly disable it and remove its UI references first.
- Existing user-to-Auth identity links, historical payment/evidence records,
  GCash QR images/amounts, and chat attachments need authorized backfill and
  reconciliation before switching production traffic.
- The local Supabase CLI is available, but Docker is not; local PostgreSQL/
  pgTAP integration tests have not been run. No remote migration, function
  deployment, or Vercel release was performed as part of this setup guide.

Treat production as **not fully migrated** until these blockers are resolved
and the smoke tests pass. See the [configuration inventory](../.github/modernize/assessment/engines/facts/configuration-inventory.md)
for the complete list of configuration sources and secret locations.

## Frontend (`frontend/.env`)

Copy `frontend/.env.example` to `frontend/.env` for local Vite development.
The frontend reads only:

- `VITE_SUPABASE_URL`: the Supabase Project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key (legacy `anon`
  key is also supported).

For Vercel, set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` in **Project Settings > Environment
Variables**. The project root directory must be `frontend`. Vercel provides
these values to the Vite build; changing a value requires a new deployment.
The local `frontend/.env` file is not uploaded to Vercel.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configure the browser's
Supabase client and are intended to be public; Supabase Row-Level Security and
Auth policies protect data access. The app already reads these variables at
build time.

Vite embeds `VITE_*` variables in browser assets. These must never contain a
database password, `service_role` key, Edge Function secret, or payment/SMS/AI
provider credential.

## Edge Function secrets

Vercel environment variables are not automatically available to Supabase Edge
Functions. A variable without the `VITE_` prefix is not exposed to this static
frontend, and setting one in Vercel does not configure the Supabase runtime.
Keep provider credentials and other private values in the Supabase project's
Edge Function secrets.

Copy `supabase/.env.example` to `supabase/.env` for local Edge Function
development. Start the functions with:

```powershell
npx.cmd supabase functions serve --env-file supabase/.env
```

The repository includes the Supabase CLI as a local npm dependency, so use
`npx.cmd` in PowerShell unless you have separately installed the CLI globally.
Local function serving also requires Docker Desktop to be installed and
running. To deploy functions to the hosted project instead, use the deployment
command in the production runbook; local `functions serve` is not required.

Supabase CLI provides project keys for local functions. Keep provider credentials
in this file only for local testing. Functions now prefer `SUPABASE_SECRET_KEY`
over the platform-provided legacy `SUPABASE_SERVICE_ROLE_KEY`; the auth function
prefers `SUPABASE_PUBLISHABLE_KEY` over `SUPABASE_ANON_KEY`. In the hosted
project, set these keys and the required values under **Supabase Dashboard >
Edge Functions > Secrets** or through the authenticated Supabase CLI. The `auth`
function needs `APP_ALLOWED_ORIGINS` and, for SMS OTP, `TEXTBEE_API_BASE`,
`TEXTBEE_API_KEY`, and the exact lowercase value `TEXTBEE_ENABLED=true`;
`TEXTBEE_DEVICE_ID` is optional when using the default TextBee device. The
chatbot needs `GEMINI_API_KEY` and the allowed production origin; its optional
model setting defaults to `gemini-3.5-flash-lite`. Set `ADMIN_BOOTSTRAP_TOKEN` and
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

## Supabase Storage S3 endpoint

The app already uploads files directly to Supabase Storage buckets with
`supabase-js` (for example, room photos go to `mbh-room-images`, and profile
pictures go to `mbh-profile-pictures`). The browser needs only
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; Supabase routes those
requests to Storage. No S3 endpoint or S3 region setting is needed for this app.

`SUPABASE_STORAGE_S3_ENDPOINT` and `SUPABASE_STORAGE_S3_REGION` are for a
separate trusted server-side S3-compatible client. Setting them alone does not
upload files, select a bucket, or migrate PHP-hosted files. Such a client also
needs S3 access credentials, which must stay server-side and must never be
added to `frontend/.env`, Vercel `VITE_*` settings, or browser code. Do not use
the S3 endpoint as the Supabase API URL.

## Legacy PHP backend

The PHP backend is a separate server and does not automatically read
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
npx.cmd supabase db push "--remote=$env:DATABASE_URL" --dry-run
```

Remove `--dry-run` only after reviewing the target and pending migrations;
applying migrations changes the remote database. Do not use a production URL
for local tests. The matching apply command is:

```powershell
npx.cmd supabase db push "--remote=$env:DATABASE_URL"
```

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
use `npx.cmd supabase db push --remote --dry-run` first. `npx.cmd supabase db push`
applies all pending migrations, not only the two chat migrations; do not apply
it until the pending list and target are understood.

An Edge Function request that appears as a CORS failure can also mean the
requested function is missing or the deployed code does not allow the browser
origin. Confirm that `admin-tenants` and `chatbot` appear in the intended
project's Edge Functions list, then deploy any missing functions only after
confirming the project reference:

```text
npx.cmd supabase functions deploy admin-tenants --remote="YOUR_PROJECT_REF" --use-api
npx.cmd supabase functions deploy chatbot --remote="YOUR_PROJECT_REF" --use-api
```

`APP_ALLOWED_ORIGINS` is a secret name/value pair under **Edge Functions >
Secrets**, not an Edge Function name. Set its value to the exact production
origin `https://myles-boarding-house.vercel.app` (plus only deliberately allowed
preview/local origins). A function named like
`APP_ALLOWED_ORIGINS-https---myles-boarding-house-vercel-app` does not configure
CORS; if it was created accidentally, remove it only after confirming it is not
used. Set `GEMINI_API_KEY` there too if chatbot responses should be enabled. An
optional `GEMINI_MODEL` setting defaults to `gemini-3.5-flash-lite`; verify the
Google AI Studio project has access to that model and its free-tier quota.
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
- [TextBee SMS sending](https://textbee.dev/docs/sending-sms/sending-sms)
- [TextBee API keys](https://textbee.dev/docs/getting-started/api-keys)
- [Gemini API keys](https://aistudio.google.com/docs/api-key)
- [Gemini API pricing and free-tier terms](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini generateContent API](https://ai.google.dev/api/generate-content)
