import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured for this Supabase Edge Function.`);
  return value;
}

export function getSupabaseUrl(): string {
  return requiredEnv("SUPABASE_URL");
}

export function getSupabaseServerKey(): string {
  return Deno.env.get("SUPABASE_SECRET_KEY")?.trim()
    || requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function getSupabasePublishableKey(): string {
  return Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim()
    || requiredEnv("SUPABASE_ANON_KEY");
}

export function createSupabaseAdminClient() {
  return createClient(getSupabaseUrl(), getSupabaseServerKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
