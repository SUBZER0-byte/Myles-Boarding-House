# One-time admin Auth bootstrap

Use this only when the existing `public.users` admin profile has `auth_user_id IS NULL` and no matching row exists in `auth.users`.

The bootstrap creates a confirmed Supabase Auth user for `public.users.user_id = 1`, links the new Auth ID to that row, and preserves its `Admin` role. It accepts a temporary token and password only through Supabase Edge Function secrets. Do not put either value in Vercel variables or browser code.

## Deploy

1. Link the Supabase CLI to the same project used by the Vercel `VITE_SUPABASE_URL`:

   ```text
   supabase link --project-ref <project-ref>
   ```

2. In the Supabase Dashboard, open **Edge Functions → Secrets** and add:
   - `ADMIN_BOOTSTRAP_TOKEN`: a random secret at least 32 characters long.
   - `ADMIN_BOOTSTRAP_PASSWORD`: a unique password at least 12 characters long.

   The deployed Auth function already uses the project's server-side `SUPABASE_SERVICE_ROLE_KEY`. Never add that key to a `VITE_*` variable.

3. Apply [`migrations/20261112223000_auth_admin_bootstrap.sql`](./migrations/20261112223000_auth_admin_bootstrap.sql) to the linked project. Use the established migration process for the project; `supabase db push` applies all pending migrations, not only this file.

4. Deploy the Edge Function:

   ```text
   supabase functions deploy admin-bootstrap --project-ref <project-ref>
   ```

## Run once

From a trusted local terminal, invoke the function with the project's publishable key and the temporary token. The password is read from the Supabase secret and is not sent in the request:

```powershell
curl.exe -X POST "https://<project-ref>.supabase.co/functions/v1/admin-bootstrap" `
  -H "apikey: <VITE_SUPABASE_PUBLISHABLE_KEY>" `
  -H "x-admin-bootstrap-token: <ADMIN_BOOTSTRAP_TOKEN>"
```

On success, verify the profile link:

```sql
SELECT user_id, username, auth_user_id, user_type
FROM public.users
WHERE user_id = 1;
```

Then remove `ADMIN_BOOTSTRAP_TOKEN` and `ADMIN_BOOTSTRAP_PASSWORD` from Edge Function secrets. The bootstrap endpoint refuses to run again after the profile is linked. Sign in at `/login` with username `admin` and the password supplied through the temporary secret.

Vercel does not deploy Supabase migrations or Edge Functions; deploy those separately as above.
