# Self-hosted Supabase deployment for Myles' Boarding House

This guide covers a Vercel frontend connected to a Supabase stack that you
operate on a Linux VPS. The current Supabase Cloud project remains the production
backend until the self-hosted instance has been migrated, tested, and
deliberately selected in Vercel. Changing the frontend URL alone does not copy
database rows, Auth users, Storage objects, Edge Functions, or secrets.

The application already reads `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` at build time. It does not need a different
frontend implementation for self-hosting.

## What you need

- A Linux VPS with a static public IP and SSH access. Supabase's documented
  minimum is 2 CPU cores, 4 GB RAM, and 40 GB SSD; 4 cores, 8 GB RAM, and
  80 GB+ SSD are recommended for production headroom.
- A domain or subdomain, for example `supabase-api.example.com`, with DNS
  pointing to the VPS.
- Docker Engine and Docker Compose on the VPS.
- Firewall access for SSH (restricted to trusted IPs when possible), and ports
  80/443 for HTTPS. Do not expose PostgreSQL or internal service ports publicly.
- A separate backup destination and a tested restore procedure. The VPS disk
  alone is not a backup.

Self-hosting makes you responsible for patching, monitoring, database
maintenance, availability, TLS, backups, and disaster recovery. Some managed
Supabase platform features, including managed backups/PITR and the Management
API, are not available.

## 1. Install the official Supabase Docker stack

On the Linux VPS, follow the current
[official Docker self-hosting guide](https://supabase.com/docs/guides/self-hosting/docker).
Use its Linux setup script or the manual installation from a pinned
self-hosted release. Review the script and release before running them; do not
copy the Supabase Docker Compose stack into this application repository because
the upstream stack is versioned and maintained separately.

Generate fresh keys and passwords using the scripts supplied by that release.
Never start the stack with example/default credentials. Keep the generated
`.env` on the VPS only, restrict its permissions, and make a protected backup
of it. The Supabase server-side secret/service-role key, database password,
JWT signing material, and Studio password must never go in Vercel.

## 2. Configure URL and HTTPS

For the examples below, replace `supabase-api.example.com` with the actual
Supabase subdomain and retain the existing Vercel site URL:

```dotenv
SUPABASE_PUBLIC_URL=https://supabase-api.example.com
API_EXTERNAL_URL=https://supabase-api.example.com/auth/v1
SITE_URL=https://myles-boarding-house.vercel.app
PROXY_DOMAIN=supabase-api.example.com
```

Configure the official Caddy reverse-proxy option (or another correctly
configured reverse proxy) so the public Supabase gateway is HTTPS on port 443.
Point DNS to the VPS and allow ports 80/443 so the proxy can obtain and renew a
certificate. The proxy must support WebSockets and forward the standard
`X-Forwarded-*` headers. Restrict Studio to trusted operators (for example by
IP allowlist or VPN) and set a strong Studio password. Do not make the
PostgreSQL port or internal Docker services public.

Set the Auth Site URL to the Vercel origin and allow only the production
redirects actually used by the app. Preview and local origins should be added
only when needed. For the app's custom Edge Functions, set
`APP_ALLOWED_ORIGINS` to the exact Vercel origin (comma-separated only when
additional trusted origins are required).

## 3. Migrate the current Supabase Cloud data

Do not point Vercel to an empty self-hosted instance. Before cutover:

1. Back up the existing Supabase Cloud database and inventory migration
   history, Auth users, profiles/identity links, and Storage buckets/objects.
2. Plan and test transfer of the database schema and data, Auth user identities,
   all seven application Storage buckets and their files, and required
   Postgres extensions/settings. Keep a mapping of old Storage paths to new
   paths and reconcile row counts and financial totals.
3. Apply this repository's SQL migrations to the self-hosted database in order.
   Review a dry run and schema compatibility first; do not blindly replay a
   baseline against existing tables. Keep PostgreSQL reachable only through a
   private network or SSH tunnel while applying migrations. The CLI must be
   pointed at the self-hosted database connection URL, not linked to the
   current hosted project.
4. Verify Auth sign-in, signup/OTP, role checks, RLS/RPC behavior, file uploads
   and signed reads, and all Admin/Tenant/Guest workflows with test accounts
   and data before using real traffic.

Self-hosted Storage uses server disk volumes. Size and monitor the volume,
include it in off-server backups, and test object restores. Supabase Cloud
Storage objects are not copied just by restoring database rows.

## 4. Install this application's Edge Functions

Self-hosted Supabase does not use the hosted Dashboard's Edge Function deploy
command. Copy the contents of this repository's `supabase/functions/` folder,
including `_shared/`, into the official stack's `volumes/functions/` directory
on the VPS. Preserve the directory layout, for example
`volumes/functions/auth/index.ts` and `volumes/functions/_shared/supabase.ts`.
The shared directory is required by the functions' relative imports.

Add a private `.env.functions` file in the official Docker stack directory for
provider settings. At minimum configure:

```dotenv
APP_ALLOWED_ORIGINS=https://myles-boarding-house.vercel.app
TEXTBEE_ENABLED=false
TEXTBEE_API_BASE=https://api.textbee.dev/api/v1
TEXTBEE_API_KEY=
TEXTBEE_DEVICE_ID=
OLLAMA_API_KEY=
OLLAMA_CLOUD_MODEL=gemma4:31b
```

Set real TextBee/Ollama values only on the VPS. To enable SMS after testing,
change `TEXTBEE_ENABLED` to the exact lowercase value `true`; the device ID is
optional when using the account's default TextBee device. Ollama Cloud uses the
server-side `OLLAMA_API_KEY`. Do not put either provider key in Vercel or any
`VITE_*` setting.

Follow the official
[self-hosted Functions instructions](https://supabase.com/docs/guides/self-hosting/self-hosted-functions)
to add `.env.functions` as an `env_file` to the `functions` service in the
official `docker-compose.yml`, then recreate that service so it receives the
new environment. Do not commit the secrets file.

Set `FUNCTIONS_VERIFY_JWT=false` in the self-hosted stack if required to allow
the app's intentionally public `auth` and `chatbot` functions. The Admin and
Tenant functions independently validate the caller's bearer token using
Supabase Auth and enforce the role in function code; still test unauthorized
and wrong-role requests before cutover. The Vercel origin must also be allowed
by the function-level CORS checks.

## 5. Configure Vercel

Keep the Vercel project Root Directory at `frontend`. Set these variables for
Production (and Preview only if those deployments are intentionally allowed):

```text
VITE_SUPABASE_URL=https://supabase-api.example.com
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key generated by this self-hosted instance>
```

Use the base HTTPS gateway URL only. Do not append `/rest/v1/`, `/auth/v1/`, or
`/storage/v1/`; `supabase-js` derives those service paths. There is no separate
PHP asset-base setting in the frontend. Old PHP-relative image paths are not
loaded; copy those files into Supabase Storage and update their database paths
if they need to be displayed. Never add a secret/service-role key, database
connection string, TextBee key, or Ollama key to Vercel.

Deploy Vercel only after the backend migration and function checks pass. Use a
test deployment/account first, verify the browser Network panel calls the new
host, and retain the old project and backups until the rollback window has
closed. Vercel redeployment is required after changing either `VITE_*` value.

## 6. Operations and rollback

- Monitor container health, disk usage, database connections, TLS renewal, and
  provider quotas. Review application and gateway logs without exposing
  secrets.
- Patch the OS and update Supabase only using its documented versioned update
  procedure. Test updates and restores before production changes.
- Keep independent encrypted backups of the database, Storage volumes, stack
  configuration, and secrets. Restrict backup access.
- For rollback, stop new writes and reconcile all post-cutover database and
  Storage changes before pointing Vercel back to Supabase Cloud. Switching the
  URL alone can lose or split user, booking, and financial records.

## Official references

- [Supabase self-hosting overview](https://supabase.com/docs/guides/self-hosting)
- [Docker installation and configuration](https://supabase.com/docs/guides/self-hosting/docker)
- [Self-hosted Edge Functions](https://supabase.com/docs/guides/self-hosting/self-hosted-functions)
- [HTTPS reverse proxy](https://supabase.com/docs/guides/self-hosting/self-hosted-proxy-https)
- [Self-hosted Auth keys](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys)
