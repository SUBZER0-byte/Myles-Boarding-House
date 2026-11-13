import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigins = new Set(
  (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "https://myles-boarding-house.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase function secrets are not configured.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return jsonResponse({ type: "error", message: "Origin is not allowed." }, 403, null);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: jsonResponse({}, 200, origin).headers,
    });
  }
  if (request.method !== "POST") {
    return jsonResponse({ type: "error", message: "Method not allowed." }, 405, origin);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ type: "error", message: "Authentication required." }, 401, origin);
  }

  const { data: authData, error: authError } = await admin.auth.getUser(authorization.slice(7));
  if (authError || !authData.user) {
    return jsonResponse({ type: "error", message: "Authentication required." }, 401, origin);
  }

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("user_type,is_active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Could not load the ratings caller profile:", profileError);
    return jsonResponse({ type: "error", message: "Could not verify the tenant account." }, 500, origin);
  }
  if (!profile || profile.user_type !== "Tenant" || profile.is_active !== 1) {
    return jsonResponse({ type: "error", message: "Tenant access is required." }, 403, origin);
  }

  let input: { action?: unknown; stars?: unknown; category?: unknown; comment?: unknown };
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ type: "error", message: "A valid JSON request body is required." }, 400, origin);
  }

  if (input.action === "list") {
    const { data, error } = await admin.rpc("get_tenant_ratings", {
      p_auth_user_id: authData.user.id,
    });
    if (error) {
      console.error("Could not load tenant ratings:", error);
      return jsonResponse({ type: "error", message: "Could not load ratings." }, 500, origin);
    }
    return jsonResponse({ type: "success", data }, 200, origin);
  }

  if (input.action !== "submit") {
    return jsonResponse({ type: "error", message: "Invalid rating action." }, 400, origin);
  }
  if (
    typeof input.stars !== "number"
    || input.stars < 1
    || input.stars > 5
    || !Number.isInteger(input.stars * 2)
    || typeof input.category !== "string"
    || typeof input.comment !== "string"
  ) {
    return jsonResponse({ type: "error", message: "Enter a valid rating, category, and feedback." }, 200, origin);
  }

  const { data, error } = await admin.rpc("submit_tenant_rating", {
    p_auth_user_id: authData.user.id,
    p_stars: input.stars,
    p_category: input.category,
    p_comment: input.comment,
  });
  if (error) {
    console.error("Could not submit tenant rating:", error);
    return jsonResponse({ type: "error", message: "Could not submit rating." }, 500, origin);
  }

  return jsonResponse(data, 200, origin);
});
