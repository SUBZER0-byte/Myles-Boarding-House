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
    .select("user_id,user_type,is_active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Could not load the notification caller profile:", profileError);
    return jsonResponse({ type: "error", message: "Could not verify the account." }, 500, origin);
  }
  if (!profile || profile.is_active !== 1 || !["Admin", "Tenant", "Guest"].includes(profile.user_type)) {
    return jsonResponse({ type: "error", message: "An active account is required." }, 403, origin);
  }

  let input: { action?: unknown; notification_id?: unknown };
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ type: "error", message: "A valid JSON request body is required." }, 400, origin);
  }

  if (input.action === "list") {
    const { data, error } = await admin
      .from("notifications")
      .select("notification_id,title,message,type,is_read,created_at")
      .eq("user_id", profile.user_id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("Could not load notifications:", error);
      return jsonResponse({ type: "error", message: "Could not load notifications." }, 500, origin);
    }
    return jsonResponse({ type: "success", data: data ?? [] }, 200, origin);
  }

  if (input.action === "unread_count") {
    const { count, error } = await admin
      .from("notifications")
      .select("notification_id", { count: "exact", head: true })
      .eq("user_id", profile.user_id)
      .eq("is_read", 0);
    if (error) {
      console.error("Could not load unread notification count:", error);
      return jsonResponse({ type: "error", message: "Could not load unread notification count." }, 500, origin);
    }
    return jsonResponse({ type: "success", data: { count: count ?? 0 } }, 200, origin);
  }

  if (input.action === "mark_all_read") {
    const { error } = await admin
      .from("notifications")
      .update({ is_read: 1 })
      .eq("user_id", profile.user_id);
    if (error) {
      console.error("Could not mark notifications as read:", error);
      return jsonResponse({ type: "error", message: "Could not update notification status." }, 500, origin);
    }
    return jsonResponse({ type: "success" }, 200, origin);
  }

  if (input.action !== "mark_read" && input.action !== "delete") {
    return jsonResponse({ type: "error", message: "Invalid notification action." }, 400, origin);
  }
  if (
    typeof input.notification_id !== "number"
    || !Number.isInteger(input.notification_id)
    || input.notification_id <= 0
  ) {
    return jsonResponse({ type: "error", message: "A valid notification ID is required." }, 400, origin);
  }

  let affectedRows: { notification_id: number }[] | null = null;
  let mutationError: { message: string } | null = null;
  if (input.action === "mark_read") {
    const result = await admin
      .from("notifications")
      .update({ is_read: 1 })
      .eq("notification_id", input.notification_id)
      .eq("user_id", profile.user_id)
      .select("notification_id");
    affectedRows = result.data;
    mutationError = result.error;
  } else {
    const result = await admin
      .from("notifications")
      .delete()
      .eq("notification_id", input.notification_id)
      .eq("user_id", profile.user_id)
      .select("notification_id");
    affectedRows = result.data;
    mutationError = result.error;
  }

  if (mutationError) {
    console.error("Could not update notification:", mutationError);
    return jsonResponse({ type: "error", message: "Could not update notification." }, 500, origin);
  }
  if (!affectedRows?.length) {
    return jsonResponse({ type: "error", message: "Notification not found." }, 200, origin);
  }
  return jsonResponse({ type: "success" }, 200, origin);
});
