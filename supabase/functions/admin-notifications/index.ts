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
    console.error("Could not load the notification administrator profile:", profileError);
    return jsonResponse({ type: "error", message: "Could not verify the administrator account." }, 500, origin);
  }
  if (!profile || profile.user_type !== "Admin" || profile.is_active !== 1) {
    return jsonResponse({ type: "error", message: "Administrator access is required." }, 403, origin);
  }

  let input: {
    action?: unknown;
    user_id?: unknown;
    user_type?: unknown;
    title?: unknown;
    message?: unknown;
    type?: unknown;
  };
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ type: "error", message: "A valid JSON request body is required." }, 400, origin);
  }

  if (input.action === "list") {
    const { data: rows, error } = await admin
      .from("notifications")
      .select("notification_id,user_id,title,message,type,is_read,created_at")
      .eq("user_id", profile.user_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("Could not load admin notifications:", error);
      return jsonResponse({ type: "error", message: "Could not load notifications." }, 500, origin);
    }

    const recipientIds = [...new Set((rows ?? []).map((row) => row.user_id))];
    const usernames = new Map<number, string>();
    if (recipientIds.length > 0) {
      const { data: profiles, error: profileLookupError } = await admin
        .from("users")
        .select("user_id,username")
        .in("user_id", recipientIds);
      if (profileLookupError) {
        console.error("Could not load notification recipient names:", profileLookupError);
        return jsonResponse({ type: "error", message: "Could not load notification recipients." }, 500, origin);
      }
      for (const recipient of profiles ?? []) usernames.set(recipient.user_id, recipient.username);
    }
    return jsonResponse({
      type: "success",
      data: (rows ?? []).map((row) => ({ ...row, username: usernames.get(row.user_id) ?? null })),
    }, 200, origin);
  }

  if (input.action === "users") {
    const { data, error } = await admin
      .from("users")
      .select("user_id,username,full_name,user_type,email")
      .eq("is_active", 1)
      .neq("user_type", "Admin")
      .order("user_type", { ascending: true })
      .order("full_name", { ascending: true })
      .order("username", { ascending: true });
    if (error) {
      console.error("Could not load notification recipients:", error);
      return jsonResponse({ type: "error", message: "Could not load active users." }, 500, origin);
    }
    const recipients = (data ?? []).map((user) => ({
      ...user,
      label: `${user.full_name ?? ""} ${user.username ?? ""}`.trim() || `#${user.user_id}`,
    }));
    return jsonResponse({ type: "success", data: recipients }, 200, origin);
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const allowedTypes = new Set(["info", "warning", "success", "error"]);
  const notificationType = typeof input.type === "string" && allowedTypes.has(input.type)
    ? input.type
    : "info";
  if (title.length === 0 || message.length === 0) {
    return jsonResponse({ type: "error", message: "Title and message are required." }, 200, origin);
  }

  if (input.action === "send") {
    if (typeof input.user_id !== "number" || !Number.isInteger(input.user_id) || input.user_id <= 0) {
      return jsonResponse({ type: "error", message: "Please select a recipient user." }, 200, origin);
    }
    const { data: recipient, error: recipientError } = await admin
      .from("users")
      .select("user_id")
      .eq("user_id", input.user_id)
      .eq("is_active", 1)
      .maybeSingle();
    if (recipientError) {
      console.error("Could not validate notification recipient:", recipientError);
      return jsonResponse({ type: "error", message: "Could not validate the recipient." }, 500, origin);
    }
    if (!recipient) return jsonResponse({ type: "error", message: "Selected user does not exist or is inactive." }, 200, origin);

    const { error } = await admin.from("notifications").insert({
      user_id: recipient.user_id,
      title,
      message,
      type: notificationType,
    });
    if (error) {
      console.error("Could not send admin notification:", error);
      return jsonResponse({ type: "error", message: "Could not send notification." }, 500, origin);
    }
    return jsonResponse({ type: "success", message: "Sent" }, 200, origin);
  }

  if (input.action === "broadcast") {
    if (!["Tenant", "Admin", "Guest"].includes(String(input.user_type))) {
      return jsonResponse({ type: "error", message: "Choose a valid user audience." }, 200, origin);
    }
    const { data: recipients, error: recipientError } = await admin
      .from("users")
      .select("user_id")
      .eq("user_type", input.user_type)
      .eq("is_active", 1);
    if (recipientError) {
      console.error("Could not load broadcast recipients:", recipientError);
      return jsonResponse({ type: "error", message: "Could not load broadcast recipients." }, 500, origin);
    }
    if (!recipients?.length) {
      return jsonResponse({ type: "success", message: "Sent to 0 users" }, 200, origin);
    }
    const rows = recipients.map((recipient) => ({
      user_id: recipient.user_id,
      title,
      message,
      type: notificationType,
    }));
    const { error } = await admin.from("notifications").insert(rows);
    if (error) {
      console.error("Could not broadcast admin notification:", error);
      return jsonResponse({ type: "error", message: "Could not broadcast notification." }, 500, origin);
    }
    return jsonResponse({ type: "success", message: `Sent to ${rows.length} users` }, 200, origin);
  }

  return jsonResponse({ type: "error", message: "Invalid notification action." }, 400, origin);
});
