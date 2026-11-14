import { createSupabaseAdminClient } from "../_shared/supabase.ts";
import { isTextBeeEnabled } from "../_shared/textbee.ts";

const allowedOrigins = new Set(
  (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "https://myles-boarding-house.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const admin = createSupabaseAdminClient();

const tenantActions = new Set([
  "tenant_list_complaints",
  "tenant_list_maintenance",
  "tenant_create_complaint",
  "tenant_create_maintenance",
  "tenant_create_room_change",
  "tenant_cancel_complaint",
  "tenant_cancel_maintenance",
  "cleanup_photo",
]);
const adminActions = new Set([
  "admin_list_complaints",
  "admin_recurring_complaints",
  "admin_list_maintenance",
  "admin_update_complaint_status",
  "admin_reply_complaint",
  "admin_update_maintenance_status",
  "admin_delete_complaint",
  "admin_delete_maintenance",
]);

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

async function signPhotoUrls(data: unknown) {
  if (!Array.isArray(data)) return data;

  const rows = data.filter((row): row is Record<string, unknown> =>
    typeof row === "object" && row !== null
  );
  const paths = rows
    .map((row) => row.photo_path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
  if (paths.length === 0) return data;

  const { data: signedPhotos, error } = await admin.storage
    .from("mbh-request-photos")
    .createSignedUrls(paths, 300);
  if (error || !signedPhotos) {
    console.error("Could not sign tenant request photos:", error);
    throw new Error("Could not load request photos.");
  }
  const urlByPath = new Map(
    signedPhotos.map((photo) => [photo.path, photo.signedUrl]),
  );
  return rows.map((row) => ({
    ...row,
    photo_url: typeof row.photo_path === "string" ? urlByPath.get(row.photo_path) ?? null : null,
  }));
}

async function sendUrgentComplaintSms(userId: number, title: string, category: string) {
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("full_name,room_id")
    .eq("user_id", userId)
    .eq("is_active", 1)
    .order("tenant_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tenantError) {
    console.error("Could not load urgent complaint SMS context:", tenantError);
    return { sms_sent: 0, sms_failures: 1 };
  }

  let roomNumber = "Unknown room";
  if (tenant?.room_id) {
    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("room_number")
      .eq("room_id", tenant.room_id)
      .maybeSingle();
    if (roomError) {
      console.error("Could not load the urgent complaint room:", roomError);
      return { sms_sent: 0, sms_failures: 1 };
    }
    roomNumber = room?.room_number ?? roomNumber;
  }

  const { data: admins, error: adminsError } = await admin
    .from("users")
    .select("phone")
    .eq("user_type", "Admin")
    .eq("is_active", 1)
    .not("phone", "is", null)
    .neq("phone", "");
  if (adminsError) {
    console.error("Could not load administrator SMS recipients:", adminsError);
    return { sms_sent: 0, sms_failures: 1 };
  }
  const recipients = [...new Set((admins ?? [])
    .map((account) => account.phone?.trim())
    .filter((phone): phone is string => Boolean(phone)))];
  if (recipients.length === 0) return { sms_sent: 0, sms_failures: 1 };

  const apiBase = Deno.env.get("TEXTBEE_API_BASE")?.trim().replace(/\/+$/, "");
  const apiKey = Deno.env.get("TEXTBEE_API_KEY")?.trim();
  const deviceId = Deno.env.get("TEXTBEE_DEVICE_ID")?.trim();
  if (!isTextBeeEnabled(Deno.env.get("TEXTBEE_ENABLED")) || !apiBase || !apiKey) {
    console.error("Urgent complaint SMS is not configured in Supabase.");
    return { sms_sent: 0, sms_failures: recipients.length };
  }

  const message = `URGENT complaint: ${tenant?.full_name ?? "A tenant"}, Room ${roomNumber}, ${category}. ${title}. Please review Admin Panel. This is not a substitute for local emergency services.`;
  try {
    const response = await fetch(`${apiBase}/gateway/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        recipients,
        message,
        ...(deviceId ? { deviceId } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error("Urgent complaint SMS delivery failed with HTTP status", response.status);
      return { sms_sent: 0, sms_failures: recipients.length };
    }
    const responseBody: unknown = await response.json();
    if (!responseBody || typeof responseBody !== "object") {
      console.error("TextBee returned an invalid success response for urgent complaint SMS.");
      return { sms_sent: 0, sms_failures: recipients.length };
    }
    return { sms_sent: recipients.length, sms_failures: 0 };
  } catch (error) {
    console.error("Urgent complaint SMS delivery failed:", error);
    return { sms_sent: 0, sms_failures: recipients.length };
  }
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
  if (typeof input.action !== "string" || (!tenantActions.has(input.action) && !adminActions.has(input.action))) {
    return jsonResponse({ type: "error", message: "Invalid request action." }, 400, origin);
  }
  const data = typeof input.data === "object" && input.data !== null && !Array.isArray(input.data)
    ? input.data as Record<string, unknown>
    : {};

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("user_id,user_type,is_active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Could not load the request caller profile:", profileError);
    return jsonResponse({ type: "error", message: "Could not verify the account." }, 500, origin);
  }
  if (!profile || profile.is_active !== 1) {
    return jsonResponse({ type: "error", message: "An active account is required." }, 403, origin);
  }
  if (tenantActions.has(input.action) && profile.user_type !== "Tenant") {
    return jsonResponse({ type: "error", message: "Tenant access is required." }, 403, origin);
  }
  if (adminActions.has(input.action) && profile.user_type !== "Admin") {
    return jsonResponse({ type: "error", message: "Administrator access is required." }, 403, origin);
  }

  if (input.action === "cleanup_photo") {
    const path = typeof data.photo_path === "string" ? data.photo_path : "";
    if (!path.startsWith(`${authData.user.id}/`)) {
      return jsonResponse({ type: "error", message: "Invalid photo path." }, 400, origin);
    }
    const [complaint, maintenance] = await Promise.all([
      admin.from("complaints").select("complaint_id").eq("photo_path", path).limit(1),
      admin.from("maintenance_requests").select("request_id").eq("photo_path", path).limit(1),
    ]);
    if (complaint.error || maintenance.error) {
      console.error("Could not verify an unlinked request photo:", complaint.error ?? maintenance.error);
      return jsonResponse({ type: "error", message: "Could not verify the uploaded photo." }, 500, origin);
    }
    if (complaint.data?.length || maintenance.data?.length) {
      return jsonResponse({ type: "error", message: "The photo is already attached to a request." }, 409, origin);
    }
    const { error } = await admin.storage.from("mbh-request-photos").remove([path]);
    if (error) {
      console.error("Could not remove an unlinked request photo:", error);
      return jsonResponse({ type: "error", message: "Could not remove the unused photo." }, 500, origin);
    }
    return jsonResponse({ type: "success" }, 200, origin);
  }

  if (input.action === "tenant_create_complaint" || input.action === "tenant_create_maintenance") {
    if (
      typeof data.title !== "string"
      || typeof data.description !== "string"
      || typeof data.category !== "string"
      || (data.photo_path !== null && data.photo_path !== undefined && typeof data.photo_path !== "string")
    ) {
      return jsonResponse({ type: "error", message: "Enter the required request details." }, 400, origin);
    }
    if (input.action === "tenant_create_complaint" && typeof data.is_urgent !== "boolean") {
      return jsonResponse({ type: "error", message: "Choose whether the complaint is urgent." }, 400, origin);
    }
    if (input.action === "tenant_create_maintenance" && typeof data.priority !== "string") {
      return jsonResponse({ type: "error", message: "Choose a maintenance priority." }, 400, origin);
    }
  }
  if (input.action === "tenant_create_room_change") {
    if (
      typeof data.requested_room_id !== "number"
      || !Number.isSafeInteger(data.requested_room_id)
      || data.requested_room_id <= 0
      || (data.reason !== undefined && typeof data.reason !== "string")
    ) {
      return jsonResponse({ type: "error", message: "Choose a valid available room." }, 400, origin);
    }
  }

  const { data: result, error: operationError } = await admin.rpc("manage_tenant_request", {
    p_action: input.action,
    p_auth_user_id: authData.user.id,
    p_data: data,
  });
  if (operationError) {
    console.error("Could not complete the tenant request action:", operationError);
    const photoPath = typeof data.photo_path === "string" ? data.photo_path : null;
    if (
      photoPath
      && (input.action === "tenant_create_complaint" || input.action === "tenant_create_maintenance")
      && photoPath.startsWith(`${authData.user.id}/`)
    ) {
      const { error: cleanupError } = await admin.storage.from("mbh-request-photos").remove([photoPath]);
      if (cleanupError) console.error("Could not remove a failed request photo upload:", cleanupError);
    }
    return jsonResponse({ type: "error", message: "Could not complete the request action." }, 500, origin);
  }
  if (!result || typeof result !== "object" || !("type" in result)) {
    console.error("Tenant request action returned an invalid response.");
    return jsonResponse({ type: "error", message: "The request service returned an invalid response." }, 500, origin);
  }
  if (result.type !== "success") return jsonResponse(result, 400, origin);

  if (
    (input.action === "tenant_list_complaints"
      || input.action === "tenant_list_maintenance"
      || input.action === "admin_list_complaints"
      || input.action === "admin_recurring_complaints"
      || input.action === "admin_list_maintenance")
    && "data" in result
  ) {
    try {
      result.data = await signPhotoUrls(result.data);
    } catch (error) {
      console.error("Could not prepare request list response:", error);
      return jsonResponse({ type: "error", message: error instanceof Error ? error.message : "Could not load request photos." }, 500, origin);
    }
  }

  if (input.action === "admin_delete_complaint" || input.action === "admin_delete_maintenance") {
    const photoPath = typeof result.photo_path === "string" ? result.photo_path : null;
    if (photoPath) {
      const { error } = await admin.storage.from("mbh-request-photos").remove([photoPath]);
      if (error) {
        console.error("Could not remove a deleted request photo:", error);
        result.message = "Request deleted, but its photo could not be removed.";
      }
    }
    delete result.photo_path;
  }

  if (input.action === "tenant_create_complaint" && data.is_urgent === true) {
    const alertResult = await sendUrgentComplaintSms(
      profile.user_id,
      String(data.title),
      String(data.category),
    );
    result.sms_sent = alertResult.sms_sent;
    result.sms_failures = alertResult.sms_failures;
  }

  return jsonResponse(result, 200, origin);
});
