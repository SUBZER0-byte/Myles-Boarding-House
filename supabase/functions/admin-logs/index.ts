import { createSupabaseAdminClient } from "../_shared/supabase.ts";

const allowedOrigins = new Set(
  (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "https://myles-boarding-house.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const admin = createSupabaseAdminClient();
const actions = new Set(["list", "delete"]);

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
    return new Response(null, { status: 204, headers: jsonResponse({}, 200, origin).headers });
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

  let input: { action?: unknown; data?: unknown };
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ type: "error", message: "A valid JSON request body is required." }, 400, origin);
  }
  if (typeof input.action !== "string" || !actions.has(input.action)) {
    return jsonResponse({ type: "error", message: "Invalid log action." }, 400, origin);
  }
  const data = typeof input.data === "object" && input.data !== null && !Array.isArray(input.data)
    ? input.data as Record<string, unknown>
    : {};

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("user_type,is_active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Could not load the Admin logs caller profile:", profileError);
    return jsonResponse({ type: "error", message: "Could not verify the account." }, 500, origin);
  }
  if (!profile || profile.user_type !== "Admin" || profile.is_active !== 1) {
    return jsonResponse({ type: "error", message: "Administrator access is required." }, 403, origin);
  }

  const { data: result, error: rpcError } = await admin.rpc("manage_admin_logs", {
    p_action: input.action,
    p_auth_user_id: authData.user.id,
    p_data: data,
  });
  if (rpcError) {
    console.error("Could not complete the Admin logs action:", rpcError);
    return jsonResponse({ type: "error", message: "Could not complete the log history action." }, 500, origin);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    console.error("Admin logs RPC returned an invalid response.");
    return jsonResponse({ type: "error", message: "The log history service returned an invalid response." }, 500, origin);
  }
  return jsonResponse(result, 200, origin);
});
