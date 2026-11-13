# Configuration & Externalized Settings Inventory

The project has separate build-time browser settings, hosted Supabase project configuration, Supabase Edge Function secrets, and legacy PHP server settings. Local `.env` files are ignored by Git; secret values are intentionally omitted from this inventory.

## Configuration Sources

| Source | Type | Path/Location | Notes |
|---|---|---|---|
| Frontend local environment | Vite build-time environment | `frontend/.env`, `frontend/.env.example` | `.env` is local and Git-ignored; only browser-safe `VITE_*` values belong here. |
| Vercel project settings | Hosted build environment | Vercel > Project > Settings > Environment Variables | Variables are injected during the Vite build; changing them requires redeployment. |
| Frontend package/build | Node.js/Vite | `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts` | Scripts include `dev`, `build`, `build:dev`, `test`, and `lint`; Vercel root is `frontend`. |
| Frontend quality/tool configuration | TypeScript, ESLint, Vitest | `frontend/tsconfig*.json`, `frontend/eslint.config.js`, `frontend/vitest.config.ts` | Vitest uses jsdom and `src/test/setup.ts`. |
| Vercel routing | SPA rewrite | `frontend/vercel.json` | Rewrites application routes to `/index.html`. |
| Supabase local/hosted config | Supabase CLI and Auth | `supabase/config.toml` | Local project name is `myles-boarding-house`; hosted project reference must come from the dashboard. Auth URL entries mirror local development and do not update hosted Auth settings. |
| Supabase database | SQL migrations and pgTAP tests | `supabase/migrations/*.sql`, `supabase/tests/*.sql` | 32 migrations and 7 SQL test files; migrations are not evidence that the remote database has been updated. |
| Supabase Edge Functions | Deno functions | `supabase/functions/*/index.ts`, `supabase/.env.example` | 16 deployable functions plus the `_shared` helper directory. Hosted secrets are configured separately from Vercel. |
| Local database connection | PostgreSQL CLI tooling | `supabase/DATABASE_URL.env.example`, local `supabase/.env.db` | Direct/pooler URL is only for trusted migration/backup tools; never browser or Vercel frontend configuration. |
| Legacy PHP configuration | PHP host environment | `backend/Config/db.php`, `backend/Config/paypal.php`, `backend/Config/paymongo.php`, `backend/Config/security.php`, `backend/Config/secrets.example.php` | PHP and MySQL/MariaDB remain for legacy PayPal and any legacy media paths until migration/backfill is complete. `backend/Config/secrets.php`, if present, is local and ignored. |
| Legacy realtime service | Composer | `backend/Realtime/composer.json` | Ratchet dependency (`^0.4.4`); not needed for Supabase-backed chat polling. |
| CI/CD configuration | GitHub Actions | `.github/workflows/` | No workflow files were found. |
| Container/orchestration configuration | Docker/Kubernetes | Repository and external host | No Supabase Docker Compose stack is vendored in the repository. The self-host deployment guide uses Supabase's upstream Docker stack and documents keeping its `.env`/Function secrets on the VPS. No Dockerfile or Kubernetes deployment configuration was found. |
| Self-host deployment guide | Supabase Docker Compose | `supabase/SELF_HOSTED_DEPLOYMENT.md` | Vercel frontend can target a self-hosted HTTPS API gateway using the existing `VITE_SUPABASE_URL`; database, Auth, Storage, and Edge Functions must be migrated/deployed separately. |

## Build Profiles

| Profile | Activation | Purpose | Key Dependencies/Plugins |
|---|---|---|---|
| Frontend development | `npm run dev` | Local Vite development server at port 5173 | Vite, React SWC; `lovable-tagger` enabled only in development mode |
| Frontend production | `npm run build` | Create static Vercel bundle in `frontend/dist` | Vite, React SWC; `VITE_*` values are embedded at build time |
| Frontend development build | `npm run build:dev` | Vite build using development mode | Same build stack; development-only component tagger |
| Frontend tests | `npm test` (`vitest run`) | Run component/service tests in jsdom | Vitest, Testing Library |
| Frontend lint | `npm run lint` | ESLint/TypeScript lint | ESLint 9 and TypeScript ESLint |
| Supabase CLI | Root `supabase` package; `npx supabase ...` | Link, inspect migrations, push SQL, deploy Functions | Supabase CLI package `^3.1.0`; Functions can use `--use-api` to avoid Docker for bundling |

No `engines` field pins Node/npm versions. The inspected workstation reports Node.js 24.16.0 and npm 11.13.0; deployment should use a Node version supported by the locked Vite/Supabase CLI dependency set.

## Runtime Profiles

| Profile | Activation Method | Config Files | Key Overrides |
|---|---|---|---|
| Local browser development | Vite development mode | `frontend/.env` | Required `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Vercel production | Vercel Production build | Vercel environment settings | Same two required public Supabase client settings |
| Vercel preview | Vercel Preview build | Vercel Preview environment settings | Configure separately only if the preview domain is allowed by Supabase Auth redirects and `APP_ALLOWED_ORIGINS` |
| Supabase local Functions | `supabase functions serve --env-file supabase/.env` | `supabase/config.toml`, `supabase/.env` | Supabase CLI injects project-local platform values; local provider keys and origins come from the env file |
| Supabase hosted Functions | Supabase Edge Function runtime | Supabase Dashboard > Edge Functions > Secrets | Platform project keys plus explicitly configured origin/provider secrets |
| Legacy PHP development | XAMPP/Apache and local MySQL/MariaDB | PHP config and ignored `backend/Config/secrets.php` | `APP_ENV=development`; PayPal defaults to sandbox; local DB defaults to `127.0.0.1:3306` |
| Legacy PHP production | PHP host process environment | PHP host settings or server-side secrets file | Database, PayPal/PayMongo, allowed-origin, and provider credentials must remain server-side |

The local Supabase config sets the Site URL to `https://myles-boarding-house.vercel.app` and includes localhost and production redirect patterns. Hosted Auth URL settings must be configured in the Supabase Dashboard separately. The `auth`, `admin-bootstrap`, and public `chatbot` Functions explicitly disable gateway JWT verification; protected Functions are configured for authenticated requests (explicitly or by the Supabase default).

## Properties Inventory

### Browser/Vercel

| Property Key | Default | Profiles | Source |
|---|---|---|---|
| `VITE_SUPABASE_URL` | None; required | Local, Vercel Production/Preview | Supabase Project URL; consumed by `frontend/src/lib/supabase.ts` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | None; required | Local, Vercel Production/Preview | Supabase publishable key; browser-safe, protected access relies on Auth and RLS |

### Supabase Functions and Storage tooling

| Property Key | Default | Profiles | Source |
|---|---|---|---|
| `SUPABASE_URL` | Supabase platform-provided | Local/hosted Functions | Supabase runtime |
| `SUPABASE_SECRET_KEY` | Optional new key; shared helper falls back to `SUPABASE_SERVICE_ROLE_KEY` | Local/hosted Functions | Supabase API keys / platform runtime; sensitive |
| `SUPABASE_PUBLISHABLE_KEY` | Optional new key; auth helper falls back to `SUPABASE_ANON_KEY` | Local/hosted Functions | Supabase API keys / platform runtime |
| `APP_ALLOWED_ORIGINS` | Function-specific production-origin fallback | Local/hosted Functions | Comma-separated exact browser origins for CORS |
| `TEXTBEE_ENABLED` | `false` in example; only exact `true` enables sends | Local/hosted Functions | Supabase Function secret |
| `TEXTBEE_API_BASE`, `TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID` | API base shown in example; key and device ID empty; device ID optional | Local/hosted Functions | TextBee service; API key is sensitive; omitting device ID uses the default device |
| `OLLAMA_API_KEY` | Empty/not enabled | Local/hosted Functions | Ollama Cloud; sensitive |
| `OLLAMA_CLOUD_MODEL` | `gemma4:31b` | Local/hosted chatbot | Function env |
| `ALLOW_DEV_OTP` | Unset/false | Development only | Auth Function; must not be enabled in production |
| `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_BOOTSTRAP_PASSWORD` | Empty | Temporary bootstrap only | Supabase Function secrets; remove after one-time use |
| `SUPABASE_STORAGE_S3_ENDPOINT`, `SUPABASE_STORAGE_S3_REGION` | Empty/optional in example | Trusted server-side S3 clients only | Supabase Storage > S3; current frontend does not consume these values |
| `DATABASE_URL` | Placeholder in example | Trusted CLI/database tools only | Supabase Dashboard > Connect; contains database credentials |

### Legacy PHP server

| Property Key | Default | Profiles | Source |
|---|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` | `127.0.0.1`, `3306`, `root`, empty password in local PHP config | Legacy PHP local/hosted | PHP host environment |
| `DB_NAME` | Environment value, then several legacy database-name candidates | Legacy PHP local/hosted | PHP host environment |
| `PAYPAL_ENV` | `sandbox` | Legacy PayPal | PHP environment or `backend/Config/secrets.php` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID` | Empty | Legacy PayPal | PHP server environment/secrets or legacy MySQL settings |
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_PUBLIC_KEY`, `PAYMONGO_WEBHOOK_SECRET` | Empty | Legacy PayMongo | PHP server environment/secrets |
| `PAYMONGO_API_BASE` | `https://api.paymongo.com/v1` | Legacy PayMongo | PHP server environment/secrets |
| `APP_BASE_URL` | `http://localhost:5173` in examples | Legacy payment callbacks | PHP server environment/secrets |
| `APP_ENV` | `development` in example | Legacy PHP | PHP server environment/secrets |
| `MBH_ALLOWED_ORIGINS` | Empty/not configured | Legacy PHP | PHP server environment; JSON origin list |

## Startup Parameters & Resource Requirements

| Service | JVM/Runtime Options | Memory | Instance Count |
|---|---|---|---|
| Vercel frontend | Node.js build; static `dist` output; no application server process | Vercel-managed; no repository limit specified | Vercel-managed |
| Supabase Postgres/Auth/Storage/Edge Functions | Supabase-managed runtime; no custom startup parameters in repository | Supabase plan-managed; no repository limits specified | Supabase-managed |
| Legacy PHP/MySQL | PHP 8.2.12 and MySQL/MariaDB observed locally; Apache/XAMPP for local legacy features | Not specified | Local or separately hosted; required only until residual PHP workflows are retired |
| Legacy Ratchet realtime server | Composer-managed PHP process | Not specified | Not specified; Supabase-backed frontend chat does not depend on it |

## Startup Dependency Chain

1. Install frontend dependencies, then run the Vite build; Vercel serves the static frontend from `frontend/dist`.
2. The browser requires the matching Supabase Project URL and publishable key, then calls the Supabase Auth, Data, Storage, and Edge Function APIs over HTTPS.
3. Supabase SQL migrations must be applied before deploying frontend code that depends on their tables, RPCs, RLS policies, and Storage buckets.
4. Supabase Edge Functions depend on platform project keys and Auth/Postgres; SMS and chatbot functions additionally depend on TextBee/Ollama secrets when those features are enabled.
5. Legacy PHP workflows depend on a PHP host and MySQL/MariaDB; PayPal is still PHP-backed. Legacy media paths may also depend on the PHP host until files and database references are backfilled.

## Secrets & Sensitive Configuration

| Secret Reference | Type | Storage (masked) |
|---|---|---|
| `SUPABASE_SECRET_KEY` / legacy `SUPABASE_SERVICE_ROLE_KEY` | Supabase privileged API key | Supabase Edge Function runtime secret; never Vercel/browser |
| `DATABASE_URL` / database password | PostgreSQL credential | Ignored local CLI file or secure password prompt; never frontend |
| `TEXTBEE_API_KEY`, `OLLAMA_API_KEY` | Provider credentials | Supabase Edge Function Secrets; local `supabase/.env` only for local testing |
| `PAYPAL_SECRET`, `PAYMONGO_SECRET_KEY`, webhook secrets | Payment-provider credentials | Legacy PHP host environment or ignored server-side secrets file |
| `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_BOOTSTRAP_PASSWORD` | Temporary privileged bootstrap credentials | Supabase Function secrets only during one-time bootstrap; remove afterward |
| S3 access key/secret | Storage S3 credentials | Supabase/S3 server-side client only; not currently consumed by this app |

### Secrets Provisioning Workflow

Browser configuration is deliberately public and limited to the Supabase Project URL and publishable key in Vercel. Supabase Edge Function secrets are provisioned independently in Supabase Dashboard > Edge Functions > Secrets; Vercel does not forward variables to Supabase. Local Function testing uses the ignored `supabase/.env`. Database credentials are only used by trusted CLI/database tooling. Legacy PHP credentials belong on the PHP server. Never commit `.env` files, put privileged credentials in `VITE_*`, or deploy the entire local env file as hosted secrets.

## Feature Flags

| Flag Name | Default | Controlled By |
|---|---|---|
| `TEXTBEE_ENABLED` | `false` in example | Supabase Function secret; SMS sends require exact `true` |
| `ALLOW_DEV_OTP` | Unset/false | Supabase Auth Function environment; development-only |
| `PAYPAL_ENV` | `sandbox` | Legacy PHP environment/secrets; `live` selects production PayPal |
| `OLLAMA_API_KEY` presence | Not configured by default | Supabase chatbot Function secret |
| Vite development mode | Enabled by `npm run dev` | Vite `import.meta.env.DEV`; controls local asset fallback and dev-only UI |

## Framework & Runtime Versions

| Component | Version | Source |
|---|---|---|
| Node.js (inspected workstation) | `v24.16.0` | `node --version`; package does not pin an engine |
| npm (inspected workstation) | `11.13.0` | `npm.cmd --version` |
| Supabase CLI | `3.1.0` | Root npm package and local CLI |
| React / React DOM | `^18.3.1` | `frontend/package.json` |
| `@supabase/supabase-js` | `^2.80.0` | `frontend/package.json` |
| Vite | `^5.4.19` | `frontend/package.json` |
| TypeScript | `^5.8.3` | `frontend/package.json` |
| Vitest | `^3.2.4` | `frontend/package.json` |
| PHP (inspected workstation) | `8.2.12` | PHP CLI |
| Ratchet | `^0.4.4` | `backend/Realtime/composer.json` |

> Note: Hosted project migration history, deployed Edge Function versions, Storage inventory, and backfill state must be checked in the Supabase Dashboard; they cannot be inferred from local configuration alone.
