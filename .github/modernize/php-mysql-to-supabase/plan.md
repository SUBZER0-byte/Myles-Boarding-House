# Migration Plan: Myle's Boarding House PHP/MySQL to Supabase

**Project**: Myle's Boarding House

## Technical Framework

- **Frontend**: React 18, TypeScript, Vite, deployed through Vercel
- **Current backend**: PHP APIs backed by MySQL; some pages already use Supabase
- **Target backend**: Existing Supabase PostgreSQL, Auth, Edge Functions, and Storage
- **Tests**: Vitest frontend/unit tests; use local Supabase for migration, RLS, RPC,
  Storage-policy, and Edge Function checks where available

## Overview

Move every Admin, Tenant, and Guest page still dependent on PHP/MySQL to the
existing Supabase deployment patterns, including file uploads. Keep the migration
incremental: complete the Supabase work already in the worktree, then migrate
booking, financial, chat, and settings capabilities in coherent slices. Each slice
must preserve current business behavior, include authorization and negative-path
tests, and update the deployment/migration guide that directly covers it.

The cutover must not expose service-role keys, payment-provider credentials, or
other secrets to the frontend. Database mutations with multiple dependent effects
must be atomic in PostgreSQL; operations involving Supabase Auth or external
payment/SMS/AI providers need explicit idempotency, compensation, and reconciliation
because those systems cannot share a PostgreSQL transaction.

## Migration Impact Summary

| Area | Current dependency | Target | Cutover constraint |
|---|---|---|---|
| Admin, Tenant, Guest data/actions | PHP APIs and MySQL, with partial Supabase coverage | Supabase Postgres/RPC/RLS and Edge Functions | Backfill and reconcile before switching each write path |
| Uploaded files | PHP-hosted uploads and legacy URL fallbacks | Supabase Storage | Copy and verify objects before replacing URLs or retiring PHP |
| Secrets and external providers | PHP configuration and server environment | Server-side Edge Function secrets/configuration | Never put privileged credentials in Vite variables or browser code |
| Hosting | Vercel frontend plus externally hosted PHP backend | Vercel frontend plus Supabase backend | This plan does not apply remote migrations, deploy functions, or publish Vercel |

## Observed Scope and Remaining PHP Dependencies

Repository inspection found these Admin/Tenant/Guest page flows still using PHP
or PHP-hosted files. Some pages have both Supabase and PHP paths; the page names
below identify the remaining PHP portion, not necessarily every read on that page.

- **Admin**: `AdminPayments` (rent ledger/actions); `AdminFullPayments`
  (requests, decisions, proof images); `AdminGuestBookingPayments` (booking
  review/payment actions); `AdminRefunds` (refund requests and evidence);
  `AdminCancellations` booking-cancellations tab (the tenancy-cancellation tab
  now calls Supabase in the worktree);   and the remaining `AdminSettings`
  payment/SMS configuration, API secrets, and GCash QR management.
  Chatbot FAQ/question administration now uses Admin-only Supabase RPCs, but
  requires migration and content backfill. `BookingPaymentDialog` still reads GCash QR data through the PHP
  public-info API.
- **Tenant**: Full-payment/refund/proof flows in `TenantPayments` now use
  Supabase; rent ledger history, submission, and rent-proof handling remain
  PHP-backed.
- **Guest**: `GuestDashboard` booking-status/public-room API reads; `GuestRooms`
  room holds, booking creation, and initial-payment submission (its room
  availability/read work is partially Supabase-backed); `GuestBooking` status,
  cancellation, and initial-payment flows; and `PaymentSuccess`/`PaymentFailed`
  booking-status reads. Shared Supabase chat and the chatbot are also used by
  Guest accounts.
- **Admin Settings**: provider/API secrets, SMS configuration, chatbot FAQ and
  suggested-question management, and GCash QR management remain PHP-backed.
- **Shared components**: `Chat.tsx` and `DashboardSidebar` now use the
  authenticated `manage_my_chat` RPC and private chat-image Storage bucket.
  `ChatbotWidget` now uses a server-side Ollama Edge Function and public
  suggested-question RPC. Audit remaining profile-image fallback URLs and API
  helpers while completing the cutover.

The repository already has Supabase implementations for several Admin and Tenant
features, including dashboard snapshots, announcements, notifications, ratings,
analytics, logs, guest management, tenant requests/ratings/room reads, settings
profiles, stay extensions, and public reads. Treat these as existing patterns and
verify that their role checks, RLS, and deployment documentation remain consistent;
do not rewrite working Supabase-backed features just to match a new abstraction.

## Worktree Baseline and Caveats

At planning time, the worktree is dirty. In addition to edits in
`backend/guides/VERCEL_EXTERNAL_PHP_DEPLOYMENT.md`, it contains changed frontend
room/photo, settings, tenant, cancellation, and public-room files; changed
`supabase/config.toml`; and untracked Supabase migrations/functions and Vitest
tests for Admin house settings, public room availability, tenant cancellations,
Admin room management, and Admin tenant management. These include the new
`admin-tenants` Edge Function and migrations timestamped
`20261113170000` through `20261113210000`.

These are pre-existing, uncommitted changes and are not assumed complete,
committed, deployed, or safe to overwrite. The first implementation slice must
inspect and finish/verify them in place, preserve unrelated edits, and reconcile
any overlap before adding new code. The current guide states that the inspected
Supabase application tables were empty and that several migrations/functions
remain unapplied/undeployed; treat this as a worktree note, not proof of the
current remote state. Verify the actual source and target data state with the
project owner before any future cutover.

## Data, Deployment, and Verification Prerequisites

Before switching production traffic, inventory and export the authoritative
MySQL data, define and test field/status/foreign-key mappings, and backfill
users/Auth identity links, tenants, rooms, bookings/holds, payments/refunds,
requests, settings, notifications, and audit history. Reconcile row counts,
financial totals, active allocations, and representative records. Do not treat
an empty Supabase database as a production-ready result.

Inventory PHP-hosted images and payment evidence, map each file to its owning
record, copy to the correct Storage bucket, and verify content type, size,
ownership/path, and retrievability before changing database paths. Plan a
controlled write freeze or another explicitly tested consistency strategy for
each cutover; do not introduce uncoordinated dual writes. Keep the PHP backend
available for rollback until read/write parity, reconciliation, and the agreed
observation window pass.

The later deployment operator must apply reviewed migrations, deploy Edge
Functions, configure server-side secrets/provider credentials, set only the
Supabase URL and publishable key in Vercel, verify Auth redirect/CORS settings,
and then publish the frontend. These are prerequisites, not actions authorized
by this plan. No remote Supabase migration, Edge Function deployment, or Vercel
publication is part of plan generation or implementation verification here.

Local verification should include builds, focused Vitest coverage, SQL migration
checks, authenticated and unauthenticated/incorrect-role RPC and RLS cases,
Storage access-policy tests, and local Edge Function request tests. Confirm
transaction rollback, duplicate/replayed payment callbacks, capacity/hold races,
and Auth/external-provider compensation. Production data parity, provider
webhooks, real Storage objects, remote RLS, and live cutover cannot be certified
without the authorized target environment and credentials.

The local chat/chatbot slice adds `20261114000000_chat_workflows.sql`,
`20261114010000_chatbot_service.sql`, and Admin-only FAQ/question management in
`20261114020000_admin_chatbot_settings.sql`, the `chatbot` Edge Function, and matching
frontend services/tests. Chat uses Supabase polling, role/participant checks,
and private attachments; the public chatbot requires the server-side
`OLLAMA_API_KEY` secret and an explicit `APP_ALLOWED_ORIGINS` allowlist. Existing
PHP-hosted chat attachments still require record-linked backfill. These local
changes do not mean the migration/function is deployed or that Ollama has been
configured. The PHP chat, Ollama, and Admin Settings sources remain for rollback
until cutover and the remaining Admin Settings/rent-ledger work are completed.

## Open Questions & Questionnaire

- [ ] Confirm the authoritative MySQL source, the target Supabase project, and the
  approved data-backfill/cutover window before production migration.
- [ ] Confirm payment-provider webhook ownership and whether legacy payment
  evidence must be retained for a defined period after Storage migration.
- [ ] Confirm which SMS and Ollama/chat provider integrations must remain enabled
  at cutover and who will provision their server-side secrets.

## Completion Criteria

- All in-scope Admin, Tenant, and Guest page actions and uploads no longer require
  PHP/MySQL; remaining PHP use is either removed from the page or explicitly
  documented as out of scope and unreachable from those routes.
- Each feature slice has business-flow tests, authorization/RLS negative tests,
  Storage-policy tests where applicable, and local build/test evidence.
- The guide lists residual PHP endpoints, required backfill and cutover checks,
  rollback/verification limits, and the fact that no remote changes were made.
- Legacy PHP services/files are not deleted until all consumers are removed and
  the authorized deployment owner has completed and verified cutover.
