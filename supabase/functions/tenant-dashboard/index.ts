import { createSupabaseAdminClient } from "../_shared/supabase.ts";

const allowedOrigins = new Set(
  (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "https://myles-boarding-house.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const admin = createSupabaseAdminClient();

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
    console.error("Could not load the dashboard caller profile:", profileError);
    return jsonResponse({ type: "error", message: "Could not verify the dashboard account." }, 500, origin);
  }
  if (!profile || profile.user_type !== "Tenant" || profile.is_active !== 1) {
    return jsonResponse({ type: "error", message: "Tenant access is required." }, 403, origin);
  }

  const { data: dashboardData, error: dashboardError } = await admin.rpc(
    "get_tenant_dashboard_snapshot",
    { p_auth_user_id: authData.user.id },
  );
  if (dashboardError) {
    console.error("Could not load the tenant dashboard snapshot:", dashboardError);
    return jsonResponse({ type: "error", message: "Could not load dashboard data." }, 500, origin);
  }
  if (!dashboardData) {
    return jsonResponse({ type: "error", message: "Tenant record not found or not linked to this account." }, 404, origin);
  }

  return jsonResponse({ type: "success", data: dashboardData }, 200, origin);
});
