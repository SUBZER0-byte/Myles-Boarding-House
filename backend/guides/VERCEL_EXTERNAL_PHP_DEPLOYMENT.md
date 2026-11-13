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
   - Any GCash/payment configuration required by the active payment flows

   The Vercel + Supabase chatbot and SMS flows use `OLLAMA_API_KEY` and
   `TEXTBEE_*` values from **Supabase Dashboard > Edge Functions > Secrets**;
   setting these on the PHP host does not configure those functions. Only
   configure provider credentials on the PHP host for legacy PHP workflows
   that are still actively used. Never expose private keys to the browser.
   Review `backend/Config/secrets.example.php` only for legacy PHP settings and
   verify that real credentials are not committed before pushing the repository.

8. **Set the allowed frontend origins.** On the PHP host set `MBH_ALLOWED_ORIGINS` to a JSON array with the exact production frontend origin(s):

   ```text
   ["https://www.example.com","https://example.com"]
   ```

   Origins are scheme + host + optional port only: no URL path and no trailing slash. Add only the Vercel production domain and any Preview domains that truly need API access. Do not use `*`; this API uses credentialed browser sessions.

9. **Start the realtime service separately if still required.** Use the PHP host's persistent process/service manager and the project's realtime setup for any remaining PHP-backed realtime features. The migrated chat page uses authenticated Supabase polling and does not require the PHP chat realtime service. A normal Vercel static deployment cannot keep a PHP process alive.

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

3. Before deploying, open **Project Settings → Environment Variables** and add only the public Supabase settings documented below. The frontend no longer has a PHP asset-base setting; legacy PHP-relative image paths will not display until their files and database paths are migrated to Supabase Storage.

4. Select **Deploy**. Wait for the build to complete, then open the provided Vercel URL.

5. If you change the API URL or other `VITE_*` setting, redeploy; Vite reads these values when building the frontend.

6. Optionally add your custom frontend domain under **Project Settings → Domains**. After DNS is verified, add its exact HTTPS origin to the PHP host's `MBH_ALLOWED_ORIGINS` and redeploy/restart the PHP service if required.

## Part 3: Verify the deployed system

Test in a private/incognito browser window:

1. The public home page and static assets load over HTTPS.
2. The browser Network panel shows data, authentication, and new Storage requests going to the configured Supabase project.
3. Public room information loads from Supabase.
4. Sign-in works; refresh a signed-in page and verify the session remains active; sign-out works.
5. Test role-specific pages and access controls with test accounts.
6. Verify uploads persist after a backend restart.
7. Test a booking and payment only in the relevant provider's sandbox until production payment credentials, webhook callbacks, and business settings have been verified.
8. Test Supabase chat polling and any remaining notifications that depend on the realtime service.
9. Check PHP, web server, database, and Vercel logs for errors. Do not paste credentials, session cookies, or private customer data into public support channels.

## Troubleshooting

- **Legacy PHP-relative images are missing:** Upload the files to the appropriate Supabase Storage buckets and update their database paths; the frontend no longer requests PHP image URLs.
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

These are public frontend configuration values. Never use a Supabase `service_role` or secret key in a `VITE_*` variable, frontend `.env` file, or browser code.

Local browser settings belong in `frontend/.env`; Edge Function secrets and the PostgreSQL connection URL do not. See [`supabase/ENVIRONMENT.md`](../../supabase/ENVIRONMENT.md) for the separate local/hosted secret setup, the documented `DATABASE_URL` connection-string workflow, Auth URL/redirect settings, and provider requirements. The direct Postgres URL is for trusted database tools, not the Vercel browser app. Use the exact host and connection mode shown in Supabase Dashboard > Connect; direct connections may require IPv6.

Admin, Tenant, and Guest page data and authentication are wired to Supabase in the local codebase. The frontend no longer requests PHP-relative image paths; migrate any legacy image files and database references to Supabase Storage before expecting those images to display.

## Supabase migration status

The local Supabase baseline is schema-only and has been reconciled against the read-only inventory of the current Supabase project: 32 existing public tables, all empty, with Row Level Security enabled and no policies. It creates the missing `payment_proofs` table and conditionally adds four missing payment-detail columns to `cancellation_requests`. It also guards the two `tenants` columns that are already present in the inspected schema, without dropping existing objects or importing records. Its `IF NOT EXISTS` clauses are intended for this inspected schema; they do not prove that arbitrary existing tables or indexes have the expected definitions.

The baseline does not connect application features to Supabase. The auth-foundation migration, `20261112010000_supabase_auth_profiles.sql`, adds a Supabase Auth identity link, a signup profile trigger, a self-profile RPC, and a service-role-only OTP challenge table. The login, signup, password-reset, and sign-out UI call the Supabase Auth helpers and `auth` Edge Function. The Auth flow and one-time Admin bootstrap have been deployed and the Admin account was successfully linked in the current production project. Existing `public.users` records still require an Auth identity link; normal signup creates new Guest identities only.

Admin, Tenant, and Guest data operations now use Supabase APIs, RPCs, and Edge Functions. PHP-relative profile, room, and chat image fallbacks have been removed; old image paths need a Storage backfill and database path update. Do not add broad public RLS policies or put Supabase service-role/secret keys in frontend configuration. Supabase TextBee and Ollama credentials belong in server-side Edge Function secrets.

Several Supabase-backed reads already exist for public rooms, homepage reviews, and statistics. The Admin Dashboard and Analytics summaries use `supabase/migrations/20261113030000_admin_dashboard_snapshot.sql` and `supabase/migrations/20261113080000_admin_analytics_snapshot.sql`, respectively, with Admin-only Edge Functions. Public announcement and house-info reads use `supabase/migrations/20261113040000_public_info_reads.sql`; Admin announcement management uses `supabase/migrations/20261113060000_admin_announcements.sql` and the role-checked `supabase/functions/admin-announcements`. The Tenant Dashboard and tenant ratings use `supabase/migrations/20261113050000_tenant_dashboard_snapshot.sql` and `supabase/migrations/20261113070000_tenant_ratings.sql`, respectively, with role-checked Edge Functions that scope data to the signed-in Tenant. User notification reads and updates use the authenticated `supabase/functions/user-notifications` for Admin, Tenant, and Guest accounts; Admin notification management uses `supabase/functions/admin-notifications`. Local code for Admin, Tenant, Guest, rent-payment, provider-settings, and integration flows is now Supabase-backed. Apply the required migrations and deploy the Edge Functions before deploying matching frontend changes; production backfill and cutover remain separate tasks.

The Guest Rooms page reads public room availability through `get_public_rooms_for_dates` in `supabase/migrations/20261113180000_public_room_availability.sql`, including overlapping tenant stays, valid bookings, and active room holds. Guest booking holds, creation, initial payment submissions, cancellation and Admin booking review now use the transactional workflow described below. Do not deploy either booking path until the data and evidence backfill is complete and verified.

Tenant and Guest profile settings now have a local Supabase implementation in `supabase/migrations/20261113090000_profile_settings.sql` and `frontend/src/lib/profileSettings.ts`. The database RPCs scope profile reads and writes to the authenticated account; password changes reauthenticate through Supabase Auth, and email changes require Supabase's confirmation email before the public profile email is synchronized. Tenant/Guest profile-picture uploads use the existing `mbh-profile-pictures` Storage bucket (maximum 5 MB); older pictures still fall back to the PHP image endpoint.

Admin rating moderation, category summaries, replies, and deletion now use `supabase/functions/admin-ratings` and `supabase/migrations/20261113130000_admin_ratings.sql`. The function verifies the active Admin identity and writes tenant reply notifications through the Supabase notifications table. Apply the migration and deploy the function before deploying this page.

Admin log history reads and deletes now use `supabase/functions/admin-logs` and `supabase/migrations/20261113140000_admin_logs.sql`. Existing PHP endpoints still write most system events to MySQL, so Supabase log history remains empty until those event writers are migrated and existing log data is intentionally backfilled. Apply the migration and deploy the function before deploying this page.

Admin Guest account management now uses `supabase/functions/admin-guests` and `supabase/migrations/20261113160000_admin_guests.sql` for listing, creation, updates, activation/deactivation, deletion, and profile-picture uploads (JPG, PNG, or WEBP up to 10 MB). Guest creation uses Supabase Auth and a short-lived, service-role-only profile claim so the public OTP signup trigger remains required for self-service signup. Apply the migration and deploy the function before deploying this page. Existing Guest records need their Auth identities linked before email/password changes or new Storage uploads can work; profile pictures with legacy PHP paths still use the PHP image endpoint until those files are migrated.

Admin Settings account profile, password, and profile-picture updates use the signed-in Supabase Auth identity and `supabase/migrations/20261113150000_admin_profile_settings.sql`. House contact details, office hours, and map coordinates now read/write Supabase `system_settings` through Admin-only RPCs in `supabase/migrations/20261113170000_admin_house_settings.sql`; this keeps public house-info reads in sync. Chatbot FAQ and suggested-question administration now uses Admin-only RPCs in `supabase/migrations/20261114020000_admin_chatbot_settings.sql`. GCash QR administration now uses `manage_gcash_qrs` and private Storage in `supabase/migrations/20261114040000_gcash_qr_storage.sql`; QR images and amounts still require an authorized upload/backfill before cutover. Admin Settings no longer retrieves or stores provider credentials through the browser; Supabase SMS/chatbot secrets belong in Supabase Edge Function secrets, while the legacy PHP PayPal flow still requires its server environment until migrated. Apply the migrations and copy current house/chatbot settings into Supabase before deploying these changes; FAQ/question content is not automatically backfilled.

Tenant maintenance and complaint workflows, including Admin review, status changes, complaint replies, and recurring-issue reporting, now use `supabase/functions/tenant-requests` and `supabase/migrations/20261113100000_tenant_requests.sql`. Request photos are stored in the private `mbh-request-photos` bucket and served with short-lived signed URLs. Urgent complaint SMS uses the Edge Function secrets `TEXTBEE_ENABLED=true`, `TEXTBEE_API_BASE`, `TEXTBEE_API_KEY`, and optionally `TEXTBEE_DEVICE_ID`; configure and test these before relying on urgent SMS alerts. These migrations and Edge Functions have not been applied or deployed. Do not deploy the matching frontend changes until the migration has been applied and the function deployed; other local Supabase implementations also require their own migration/function deployment and data backfill.

The Tenant Room page reads the signed-in tenant's assignment through `get_my_tenant_room` in `supabase/migrations/20261113110000_tenant_room_read.sql`, and reads vacancies through the existing public-room RPC. Stay-extension requests and their Admin review/decision flow now use `supabase/functions/stay-extensions` and `supabase/migrations/20261113120000_stay_extensions.sql`, including booking date and payment-schedule updates. Room-change request submission now uses the authenticated `tenant-requests` function and `manage_tenant_request`; the legacy PHP endpoint only inserted requests and had no Admin decision workflow, so none was migrated. Payment schedules and refund workflows now have local Supabase implementations, but the inspected Supabase application tables were empty, so applying these schema changes alone will not make existing tenants, bookings, or payments available. Do not deploy this slice until its SQL migrations and Edge Functions are applied and verified, the required data is backfilled, and the remaining PHP PayPal flow is coordinated with the Supabase records.

Tenant cancellation requests and their Admin review/decision flow now use the authenticated `manage_tenant_cancellation` RPC in `supabase/migrations/20261113190000_tenant_cancellations.sql`. Approval records the refund, deactivates the tenant, changes the account role to Guest, refreshes the room status, and notifies the tenant in one database transaction. Guest booking cancellation preserves the booking/payment audit trail without issuing a refund; Guest refund requests use the separate financial workflow. Apply migrations and backfill the related users, tenants, rooms, and cancellation records before deploying; test the refund ledger and room-availability behavior against the target Supabase project first.

Admin room CRUD, room status changes, cover uploads, and gallery-photo management now use `supabase/migrations/20261113200000_admin_room_management.sql`, the `mbh-room-images` Storage bucket, and authenticated Admin RPCs. Capacity changes are blocked while a room has active tenant, booking, or hold records; deletion is blocked while related records remain. Public room-image readers now support Storage paths while retaining legacy PHP image URLs. Apply the migration and backfill room, booking, tenant, and room-image data before deploying; gallery/cover images already on PHP must be copied to Storage before their legacy host is retired.

Admin tenant listing, account linking, creation, updates, deactivation, deletion, room assignment, password/email changes, and profile-picture uploads now use the Admin-checked `supabase/functions/admin-tenants` and `supabase/migrations/20261113210000_admin_tenant_management.sql`; profile pictures use the existing `mbh-profile-pictures` bucket. The migration and function have not been applied or deployed. Before cutover, apply the migration, deploy the function, link existing tenant Auth identities, backfill tenant/room data and legacy profile pictures, and validate room capacity and Auth email/password changes on the target project. Deletion is blocked when dependent history exists; deactivate those records instead.

Guest room holds, booking creation/ownership reads/cancellation, initial GCash payment submission, Admin booking review, booking-status transitions, and the cancelled-bookings review tab now use `manage_guest_booking` in `supabase/migrations/20261113220000_guest_booking_workflow.sql`. Capacity is serialized per room in PostgreSQL; booking creation and its initial-payment request are one transaction, guest and Admin retries are guarded by request keys/state checks, and payment proof uploads use the private `mbh-booking-payment-proofs` bucket with guest-folder insert and owner/Admin read policies. Admin proof links are short-lived signed URLs. Cancellation retains financial/audit history and does not issue a refund.

This booking slice is local source only: the migration has not been applied, functions have not been deployed, and no Vercel release or live SQL was performed. Before any cutover, apply and review the migration, backfill and link each existing booking to the correct `users.auth_user_id`, reconcile active capacity holds/bookings and payment ledger totals, copy legacy proof files to the private bucket and verify their record links, and test ownership, role denial, concurrent booking, idempotent retry, expiry, cancellation and transaction rollback against a disposable/local Supabase database. Existing booking proof paths that are not in the new Storage layout are intentionally not opened from the Admin page until backfill is complete.

The payment dialog and Admin GCash QR management now use the authenticated `manage_gcash_qrs` RPC and private `mbh-payment-qrs` Storage bucket from `supabase/migrations/20261114040000_gcash_qr_storage.sql`. All QR images, including the former fixed-amount images, must be uploaded through Admin Settings and assigned their exact amounts before payment submissions are enabled. The payment dialog no longer falls back to PHP-hosted QR images; rent payment submission also requires a matching QR record and Storage object. Apply the migration and verify each configured amount/image before deploying these frontend changes. Existing GCash reference/screenshot submission remains a manual Admin-review flow; no payment-provider webhook or callback was added.

## Financial workflow migration (local source only)

`supabase/migrations/20261113230000_financial_workflows.sql` adds the authenticated `manage_financial_workflows` RPC and a private `mbh-financial-evidence` Storage bucket. It moves the Tenant full-payment request/proof flow, Admin full-payment review, the shared Tenant/Guest refund-request flow, and Admin refund decisions to Supabase. `supabase/migrations/20261114030000_rent_payment_ledger.sql` adds the authenticated `manage_rent_ledger` RPC and moves Tenant rent history/GCash proof submission and Admin rent ledger, schedule, status, and review operations to Supabase. Schedule and payment mutations run in PostgreSQL transactions; tenant ownership and Admin role checks are derived from the authenticated profile. GCash references are checked against the shared reference table and financial records. Private evidence uploads use the authenticated user's Storage folder; linked evidence remains readable only by its record owner or an Admin, through short-lived signed URLs.

This is **not a production financial cutover**. Full-payment/refund RPCs and the rent ledger use the local Supabase source, but the following cutover work remains:

- GCash QR administration and authenticated booking/rent QR reads now use Supabase RPCs and private Storage, but existing QR rows and media are not backfilled automatically. Re-upload each currently supported QR and set its exact fixed amount in Admin Settings before enabling payments; old PHP QR images are no longer used as a fallback. Legacy PayPal settings still belong to the PHP server environment.
- SMS delivery for rent payment notifications is not performed by the new SQL RPC. Database notifications are written transactionally, but rent-payment SMS delivery still needs a server-side Edge Function using the configured TextBee secrets before claiming SMS parity.
- The legacy PHP rent/full-payment/refund handlers and their uploads remain in the backend for rollback/reference. Do not use the old PHP and new Supabase write paths concurrently, or assume MySQL payments, GCash references, notifications, or PHP-hosted proof files have been copied to Supabase.

A controlled source-data export/backfill, identity/tenant/payment mapping, proof-file copy, QR media copy, row-count and financial-total reconciliation, and verified ownership checks are required before using this local implementation with production traffic. The Supabase refund path for Guest booking payments depends on `bookings.guest_user_id` from the preceding `20261113220000_guest_booking_workflow.sql`; apply migrations in timestamp order.

Before any authorized cutover, apply/review the financial migrations against a disposable/local database; run the pgTAP authorization, duplicate submission, scheduling, rollback, and private Storage tests; then reconcile the MySQL and Supabase ledgers and evidence inventories. SQL tests were not run in this environment because `psql`, Supabase CLI, Docker, and Podman are unavailable. For rollback after writes begin, stop writes, export/reconcile all post-cutover Supabase transactions and evidence back to the authoritative MySQL system, and only then restore PHP traffic; switching the frontend back alone would lose newer financial records. The migration has **not** been applied or deployed, no remote Supabase changes were made, and this work does not process a payment or send a provider callback.

## Shared chat migration (local source only)

The shared Admin/Tenant/Guest `Chat` page and the sidebar unread-message badge now call `manage_my_chat` in `supabase/migrations/20261114000000_chat_workflows.sql` instead of `/Chat/messages.php`. The RPC derives identity from the signed-in Supabase Auth profile, keeps Guest conversations Admin-only, scopes message reads/removal to the two participants, marks incoming messages read, and creates a recipient notification in the same transaction as a send. Existing three-second polling behavior is retained.

New chat attachments use the private `mbh-chat-images` bucket. Uploads are limited to five JPG/PNG/WEBP images per message, 30 MB each and 150 MB total; signed reads are restricted to linked, non-unsent messages and their participants. Legacy PHP-hosted attachment paths retain the old URL fallback and must be copied/reconciled before the PHP host can be retired. The migration has not been applied; the pgTAP tests in `supabase/tests/chat_workflows.test.sql` could not be run because local PostgreSQL/Supabase tooling is unavailable.

`ChatbotWidget` and public suggested-question reads now use `supabase/functions/chatbot` and `get_public_chatbot_suggestions` in `supabase/migrations/20261114010000_chatbot_service.sql`. The function receives the Ollama credential only from the server-side `OLLAMA_API_KEY` secret, uses public Supabase room/house/announcement and FAQ data for context, and limits anonymous requests by hashed client IP (8 per minute and 50 per hour). It is configured with `verify_jwt = false` because the widget is public; configure `APP_ALLOWED_ORIGINS` to the exact production and approved preview origins. For local development, set the allowed origin explicitly.

The hosted `OLLAMA_API_KEY` has not been verified in the target Supabase project. Configure it (and optionally `OLLAMA_CLOUD_MODEL`) as a Supabase Edge Function secret before relying on chatbot responses. FAQ and suggested-question administration now has a Supabase implementation but still requires migration application and an authorized content backfill. Configure TextBee only as Supabase Edge Function secrets for Supabase SMS workflows; legacy PHP PayPal configuration remains on the PHP host until its payment endpoints are migrated. GCash QR management now uses Supabase Storage/RPC but requires its migration and image/amount backfill before use. Never copy Ollama, TextBee, PayPal, or other provider credentials into Vite/Vercel `VITE_*` variables. The chatbot migration, function, and SQL tests have not been deployed or run against PostgreSQL.
