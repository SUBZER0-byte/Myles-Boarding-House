# Deployment Tutorial: Vercel Frontend + External PHP/MySQL Backend

This tutorial deploys the React/Vite frontend to Vercel and the PHP API to a separate PHP host with MySQL. The PHP API uses `mysqli`; this is **not** a Supabase deployment. Supabase uses PostgreSQL and would require a backend and database migration.

The YouTube link supplied for this project redirects to a video whose setup instructions could not be verified here. These steps are based on the project's current configuration.

## What you need

- A GitHub account and this project pushed to a GitHub repository.
- A Vercel account connected to that repository.
- A PHP hosting provider that supports this app's PHP version/extensions, MySQL, persistent file storage, HTTPS, and long-running PHP processes for the realtime service.
- A domain or subdomain for the PHP API is recommended (for example `api.example.com`).
- Access to configure environment variables and create/import a MySQL database on the PHP host.

Vercel only serves the frontend in this architecture. It does not host this PHP API, MySQL database, uploads, or the long-running realtime PHP service.

## Part 1: Prepare and deploy the PHP backend

1. **Choose and provision a PHP host.** Confirm with the provider that it supports the PHP version used by the app and these PHP extensions: `mysqli`, `curl`, `mbstring`, `fileinfo`, `gd`, `openssl`, and `json`. Confirm writable persistent storage for `backend/uploads` and any other runtime files, outbound HTTPS requests, and a way to run the realtime PHP server as a persistent service.

2. **Create a MySQL database and restricted database user.** Give the user access only to this application's database. Do not use a hosting-wide administrator account.

3. **Deploy the backend files.** Upload the contents of this project's `backend` directory to the provider. Configure the public API base URL to point at that directory; for example:

   ```text
   https://api.example.com/backend
   ```

   The exact URL depends on where the provider serves the uploaded files. Check that a PHP endpoint can be reached over HTTPS before connecting the frontend.

4. **Configure database environment variables** on the PHP host:

   ```text
   DB_HOST=<database-host-from-provider>
   DB_PORT=<database-port-from-provider>
   DB_NAME=<database-name>
   DB_USER=<restricted-database-user>
   DB_PASSWORD=<strong-database-password>
   ```

   `backend/Config/db.php` reads these values. Do not put database credentials in Vercel or frontend `.env` files.

5. **Create the database schema.** The SQL dumps in `backend/database` have had embedded records removed; they contain schema definitions only. The dumps represent different snapshots, so do not import all of them into the same database. Choose the schema that matches the current application, compare it with the current `backend/migrations` scripts, and test the complete import/migration sequence on a disposable database before using production. Apply any required migrations in the order documented by the project/provider. Back up the database before applying schema changes.

6. **Create the initial administrator through the supported signup/admin setup flow.** The cleaned SQL files intentionally do not contain user records. Do not copy real production data or password hashes from an old dump into a public demo database.

7. **Configure backend secrets on the PHP host.** Use provider environment variables or the private `backend/Config/secrets.php` file, never a public web directory or Git commit. The project may need values for:

   - `APP_ENV=production`
   - `APP_BASE_URL=https://www.example.com`
   - `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, and `PAYPAL_WEBHOOK_ID` if PayPal is enabled
   - `OLLAMA_API_KEY` if the AI chatbot is enabled
   - TextBee/SMS credentials if SMS is enabled
   - Any GCash/payment configuration required by the active payment flows

   Configure each integration using its provider's production credentials and webhook settings. Do not expose private keys to the browser. Review `backend/Config/secrets.example.php` for the supported example keys. Verify that real credentials are not committed before pushing the repository.

8. **Set the allowed frontend origins.** On the PHP host set `MBH_ALLOWED_ORIGINS` to a JSON array with the exact production frontend origin(s):

   ```text
   ["https://www.example.com","https://example.com"]
   ```

   Origins are scheme + host + optional port only: no URL path and no trailing slash. Add only the Vercel production domain and any Preview domains that truly need API access. Do not use `*`; this API uses credentialed browser sessions.

9. **Start the realtime service separately.** Use the PHP host's persistent process/service manager and the project's realtime setup. Record its public secure WebSocket URL and configure the frontend/backend wherever this project expects it. A normal Vercel static deployment cannot keep this PHP process alive. Test real-time chat/notifications after deployment.

10. **Check PHP session and upload storage.** PHP sessions and uploads must be stored persistently. Keep HTTPS enabled. The API sets an HTTP-only `SameSite=Lax` session cookie and the frontend uses credentialed requests. A custom frontend domain and API subdomain under the same registrable domain (for example `www.example.com` and `api.example.com`) is recommended because browsers may block cookies on unrelated domains.

## Part 2: Deploy the frontend to Vercel

1. Push the project to GitHub. From the Vercel dashboard choose **Add New → Project**, connect GitHub if needed, and import the repository.

2. In the Vercel project setup, set:

   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`

   The `frontend/vercel.json` file provides the SPA fallback so direct visits and browser refreshes on React routes load the app.

3. Before deploying, open **Project Settings → Environment Variables** and add:

   ```text
   VITE_API_BASE_URL=https://api.example.com/backend
   ```

   Replace the example with the actual public HTTPS API base URL from Part 1. This variable is embedded in the frontend bundle, so it must not contain credentials or any other secret. Add it for the Production environment and for Preview only if Preview builds should access the backend.

4. Select **Deploy**. Wait for the build to complete, then open the provided Vercel URL.

5. If you change the API URL or other `VITE_*` setting, redeploy; Vite reads these values when building the frontend.

6. Optionally add your custom frontend domain under **Project Settings → Domains**. After DNS is verified, add its exact HTTPS origin to the PHP host's `MBH_ALLOWED_ORIGINS` and redeploy/restart the PHP service if required.

## Part 3: Verify the deployed system

Test in a private/incognito browser window:

1. The public home page and static assets load over HTTPS.
2. The browser Network panel shows API calls going to the expected `VITE_API_BASE_URL`, not localhost.
3. Public room information loads from the backend.
4. Sign-in works; refresh a signed-in page and verify the session remains active; sign-out works.
5. Test role-specific pages and access controls with test accounts.
6. Verify uploads persist after a backend restart.
7. Test a booking and payment only in the relevant provider's sandbox until production payment credentials, webhook callbacks, and business settings have been verified.
8. Test chat/notifications that depend on the realtime service.
9. Check PHP, web server, database, and Vercel logs for errors. Do not paste credentials, session cookies, or private customer data into public support channels.

## Troubleshooting

- **API calls still go to localhost:** Confirm `VITE_API_BASE_URL` is set in the correct Vercel environment and redeploy.
- **CORS or “bad origin” errors:** Set `MBH_ALLOWED_ORIGINS` to the exact browser origin, formatted as a JSON array. Check HTTPS, scheme, subdomain, and port.
- **Login succeeds but does not persist:** Check HTTPS, cookie `SameSite`/domain behavior, persistent PHP session storage, and whether the frontend and API are on related custom domains.
- **Database connection fails:** Verify `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`; confirm the PHP host can connect to the database and has `mysqli` enabled.
- **Direct React route returns 404:** Confirm Vercel's Root Directory is `frontend` and `frontend/vercel.json` is deployed.
- **Uploads or realtime features fail:** Confirm persistent writable storage and that the realtime server is running on its separate persistent host.
- **Payment or SMS does not work:** Check production credentials, provider webhook URLs, callback reachability, and provider-side account activation.

## Supabase environment variables

The frontend uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to connect its Supabase client. Adding these values in Vercel does not, by itself, migrate every PHP-backed feature.

If you are preparing those placeholders in Vercel:

1. Create or select your Supabase project and open its **Connect** panel.
2. Copy the Project URL into Vercel as `VITE_SUPABASE_URL`.
3. Copy the publishable key (or legacy `anon` key) into Vercel as `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Add the variables to the Vercel environment(s) you need and redeploy after changes.

These are public frontend configuration values. Never use a Supabase `service_role` or secret key in a `VITE_*` variable, frontend `.env` file, or browser code. Do not point `VITE_API_BASE_URL` at the Supabase project URL: it is a legacy PHP API base and remains necessary for features that have not yet been migrated.

The remaining legacy features still depend on the PHP backend, which talks to MySQL through `mysqli`; it does not use Supabase's React Data API. Migrating those features requires carefully designed Row Level Security policies and server-side operations.

## Supabase migration status

The local Supabase baseline is schema-only and has been reconciled against the read-only inventory of the current Supabase project: 32 existing public tables, all empty, with Row Level Security enabled and no policies. It creates the missing `payment_proofs` table and conditionally adds four missing payment-detail columns to `cancellation_requests`. It also guards the two `tenants` columns that are already present in the inspected schema, without dropping existing objects or importing records. Its `IF NOT EXISTS` clauses are intended for this inspected schema; they do not prove that arbitrary existing tables or indexes have the expected definitions.

The baseline does not connect application features to Supabase. The auth-foundation migration, `20261112010000_supabase_auth_profiles.sql`, adds a Supabase Auth identity link, a signup profile trigger, a self-profile RPC, and a service-role-only OTP challenge table. The login, signup, password-reset, and sign-out UI call the Supabase Auth helpers and `auth` Edge Function. The Auth flow and one-time Admin bootstrap have been deployed and the Admin account was successfully linked in the current production project. Existing `public.users` records still require an Auth identity link; normal signup creates new Guest identities only.

Many PHP API call sites remain across the frontend, and those PHP endpoints still use MySQLi. `VITE_API_BASE_URL` remains necessary until those workflows are migrated. Do not point it at the Supabase project URL, add broad public RLS policies, or put Supabase service-role/secret keys in frontend configuration. A complete migration still requires feature-specific RLS policies and server-side Edge Functions for privileged operations and TextBee.

Several Supabase-backed reads already exist for public rooms, homepage reviews, and statistics. The Admin Dashboard and Analytics summaries use `supabase/migrations/20261113030000_admin_dashboard_snapshot.sql` and `supabase/migrations/20261113080000_admin_analytics_snapshot.sql`, respectively, with Admin-only Edge Functions. Public announcement and house-info reads use `supabase/migrations/20261113040000_public_info_reads.sql`; Admin announcement management uses `supabase/migrations/20261113060000_admin_announcements.sql` and the role-checked `supabase/functions/admin-announcements`. The Tenant Dashboard and tenant ratings use `supabase/migrations/20261113050000_tenant_dashboard_snapshot.sql` and `supabase/migrations/20261113070000_tenant_ratings.sql`, respectively, with role-checked Edge Functions that scope data to the signed-in Tenant. User notification reads and updates use the authenticated `supabase/functions/user-notifications` for Admin, Tenant, and Guest accounts; Admin notification management uses `supabase/functions/admin-notifications`. Apply the migrations and deploy the Edge Functions before deploying the matching frontend changes. These code changes do not migrate the other Admin, Tenant, Guest, payment, booking, chat, or integration endpoints; those features still depend on the PHP API and MySQL until individually ported and verified.

Tenant and Guest profile settings now have a local Supabase implementation in `supabase/migrations/20261113090000_profile_settings.sql` and `frontend/src/lib/profileSettings.ts`. The database RPCs scope profile reads and writes to the authenticated account; password changes reauthenticate through Supabase Auth, and email changes require Supabase's confirmation email before the public profile email is synchronized. Tenant/Guest profile-picture uploads use the existing `mbh-profile-pictures` Storage bucket (maximum 5 MB); older pictures still fall back to the PHP image endpoint.

Admin rating moderation, category summaries, replies, and deletion now use `supabase/functions/admin-ratings` and `supabase/migrations/20261113130000_admin_ratings.sql`. The function verifies the active Admin identity and writes tenant reply notifications through the Supabase notifications table. Apply the migration and deploy the function before deploying this page.

Admin log history reads and deletes now use `supabase/functions/admin-logs` and `supabase/migrations/20261113140000_admin_logs.sql`. Existing PHP endpoints still write most system events to MySQL, so Supabase log history remains empty until those event writers are migrated and existing log data is intentionally backfilled. Apply the migration and deploy the function before deploying this page.

Admin Guest account management now uses `supabase/functions/admin-guests` and `supabase/migrations/20261113160000_admin_guests.sql` for listing, creation, updates, activation/deactivation, deletion, and profile-picture uploads (JPG, PNG, or WEBP up to 10 MB). Guest creation uses Supabase Auth and a short-lived, service-role-only profile claim so the public OTP signup trigger remains required for self-service signup. Apply the migration and deploy the function before deploying this page. Existing Guest records need their Auth identities linked before email/password changes or new Storage uploads can work; profile pictures with legacy PHP paths still use the PHP image endpoint until those files are migrated.

Admin Settings account profile, password, and profile-picture updates now use the signed-in Supabase Auth identity, `supabase/migrations/20261113150000_admin_profile_settings.sql`, and the existing profile-picture Storage bucket. The rest of Admin Settings (house/payment configuration, API secrets, chatbot FAQs, and GCash QR management) remains PHP-backed and must not be assumed migrated.

Tenant maintenance and complaint workflows, including Admin review, status changes, complaint replies, and recurring-issue reporting, now use `supabase/functions/tenant-requests` and `supabase/migrations/20261113100000_tenant_requests.sql`. Request photos are stored in the private `mbh-request-photos` bucket and served with short-lived signed URLs. Urgent complaint SMS uses the Edge Function secrets `TEXTBEE_ENABLED=true`, `TEXTBEE_API_BASE`, `TEXTBEE_API_KEY`, and optionally `TEXTBEE_DEVICE_ID`; configure and test these before relying on urgent SMS alerts. These migrations and Edge Functions have not been applied or deployed. Do not deploy the matching frontend changes until the migration has been applied and the function deployed; other PHP-backed workflows remain unchanged.

The Tenant Room page reads the signed-in tenant's assignment through `get_my_tenant_room` in `supabase/migrations/20261113110000_tenant_room_read.sql`, and reads vacancies through the existing public-room RPC. Stay-extension requests and their Admin review/decision flow now use `supabase/functions/stay-extensions` and `supabase/migrations/20261113120000_stay_extensions.sql`, including booking date and payment-schedule updates. Room-change request submission now uses the authenticated `tenant-requests` function and `manage_tenant_request`; the legacy PHP endpoint only inserted requests and had no Admin decision workflow, so none was migrated. The rest of Admin booking/payment management remains on PHP. The inspected Supabase application tables were empty, so applying these schema changes alone will not make existing tenants, bookings, or payments available. Do not deploy this slice until its SQL migrations and Edge Functions are applied and verified, the required data is backfilled, and the remaining PHP booking/payment flows are coordinated with the Supabase records.
