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
    console.error("Could not load the announcement caller profile:", profileError);
    return jsonResponse({ type: "error", message: "Could not verify the administrator account." }, 500, origin);
  }
  if (!profile || profile.user_type !== "Admin" || profile.is_active !== 1) {
    return jsonResponse({ type: "error", message: "Administrator access is required." }, 403, origin);
  }

  let input: {
    action?: unknown;
    announcement_id?: unknown;
    title?: unknown;
    body?: unknown;
    is_published?: unknown;
  };
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ type: "error", message: "A valid JSON request body is required." }, 400, origin);
  }

  const validActions = new Set(["list", "create", "update", "publish", "delete"]);
  if (typeof input.action !== "string" || !validActions.has(input.action)) {
    return jsonResponse({ type: "error", message: "Invalid announcement action." }, 400, origin);
  }

  const { data, error } = await admin.rpc("manage_admin_announcement", {
    p_action: input.action,
    p_auth_user_id: authData.user.id,
    p_announcement_id: typeof input.announcement_id === "number" ? input.announcement_id : null,
    p_title: typeof input.title === "string" ? input.title : null,
    p_body: typeof input.body === "string" ? input.body : null,
    p_is_published: input.is_published === 0 || input.is_published === 1 ? input.is_published : null,
  });
  if (error) {
    console.error("Could not complete the announcement action:", error);
    return jsonResponse({ type: "error", message: "Could not complete the announcement action." }, 500, origin);
  }
  if (
    !data
    || typeof data !== "object"
    || !("type" in data)
    || (data.type !== "success" && data.type !== "error")
  ) {
    console.error("Announcement action returned an invalid response.");
    return jsonResponse({ type: "error", message: "The announcement service returned an invalid response." }, 500, origin);
  }

  return jsonResponse(data, 200, origin);
});
