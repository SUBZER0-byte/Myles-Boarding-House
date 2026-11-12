import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const bootstrapToken = Deno.env.get("ADMIN_BOOTSTRAP_TOKEN");
const bootstrapPassword = Deno.env.get("ADMIN_BOOTSTRAP_PASSWORD");

if (
  !supabaseUrl
  || !serviceRoleKey
  || !bootstrapToken
  || bootstrapToken.length < 32
  || !bootstrapPassword
  || bootstrapPassword.length < 12
  || bootstrapPassword.length > 200
) {
  throw new Error("Admin bootstrap secrets are not configured.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const encoder = new TextEncoder();

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function tokensMatch(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ message: "Method not allowed." }, 405);
  }

  const suppliedToken = request.headers.get("x-admin-bootstrap-token") ?? "";
  if (!tokensMatch(suppliedToken, bootstrapToken)) {
    return jsonResponse({ message: "Unauthorized." }, 401);
  }

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("user_id,email,user_type,auth_user_id")
    .eq("user_id", 1)
    .eq("username", "admin")
    .maybeSingle();

  if (profileError) {
    console.error("Could not load the admin profile for bootstrap:", profileError);
    return jsonResponse({ message: "Could not check the admin profile." }, 500);
  }
  if (!profile || profile.user_type !== "Admin" || profile.auth_user_id || !profile.email) {
    return jsonResponse({ message: "No eligible unlinked admin profile was found." }, 409);
  }

  const { data, error: createError } = await admin.auth.admin.createUser({
    email: profile.email,
    password: bootstrapPassword,
    email_confirm: true,
    app_metadata: { mbh_admin_bootstrap: true },
  });

  if (createError || !data.user) {
    console.error("Could not create the admin Auth identity:", createError);
    return jsonResponse({ message: "Could not create the admin Auth identity." }, 409);
  }

  const { data: linkedProfile, error: linkError } = await admin
    .from("users")
    .select("auth_user_id")
    .eq("user_id", profile.user_id)
    .maybeSingle();

  if (linkError || linkedProfile?.auth_user_id !== data.user.id) {
    console.error("The admin Auth identity was created but the profile link could not be verified.", linkError);
    return jsonResponse({ message: "The Auth account was created, but its profile link could not be verified." }, 500);
  }

  return jsonResponse({
    type: "success",
    message: "The admin Auth account was created and linked.",
    user_id: profile.user_id,
    auth_user_id: data.user.id,
  }, 200);
});
